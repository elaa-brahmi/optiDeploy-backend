const User = require('../models/user');
const Project = require('../models/repo');
const Report = require('../models/report');
const { GoogleGenerativeAI } = require("@google/generative-ai");

let OctokitCached = null;
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function getOctokit() {
    if (!OctokitCached) {
        const mod = await import('@octokit/rest');
        OctokitCached = mod.Octokit;
    }
    return OctokitCached;
}

async function listAvailableModels() {
    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1/models?key=${process.env.GEMINI_API_KEY}`
        );
        const data = await response.json();

        console.log("--- AVAILABLE MODELS ---");
        data.models.forEach((model) => {
            console.log(`- Model: ${model.name}`);
            console.log(`  Methods: ${model.supportedGenerationMethods.join(", ")}`);
        });
        console.log("-------------------------");
        return data.models;
    } catch (error) {
        console.error("Error listing models:", error);
    }
}

async function analyzeRepo(req, res) {
    const { repoId } = req.params;

    try {
        const project = await Project.findOne({ repoId });

        if (!project) {
            return res.status(404).json({ error: "Project not found" });
        }

        const user = await User.findOne({ githubId: project.userId });

        if (!user || !user.accessToken) {
            return res.status(404).json({ error: "User not found or missing access token" });
        }

        const Octokit = await getOctokit();
        const octokit = new Octokit({ auth: user.accessToken });

        const { data: files } = await octokit.rest.repos.getContent({
            owner: project.owner,
            repo: project.name,
            path: '',
        });

        const fileList = files.map(f => f.name);
        let gitignoreContent = "Not found";

        if (fileList.includes('.gitignore')) {
            const { data: gi } = await octokit.rest.repos.getContent({
                owner: project.owner,
                repo: project.name,
                path: '.gitignore'
            });
            gitignoreContent = Buffer.from(gi.content, 'base64').toString();
        }
        const entryPoints = ['index.js', 'app.js', 'server.js', 'main.py', 'src/index.ts', 'server.ts', 'app/page.tsx', 'middleware.ts'];
        const configCheck = ['next.config.js', 'next.config.mjs', 'middleware.ts', 'middleware.js', 'vercel.json'];
        const mainFile = fileList.find(name => entryPoints.includes(name));
        const securityConfigs = fileList.filter(name => configCheck.includes(name));
        let entryCodeSnippet = "No entry file found for code analysis.";
        let contextualCode = "";

        if (mainFile) {
            const { data: content } = await octokit.rest.repos.getContent({
                owner: project.owner, repo: project.name, path: mainFile
            });
            const decodedCode = Buffer.from(content.content, 'base64').toString();
            entryCodeSnippet = decodedCode.split('\n').slice(0, 50).join('\n');
            contextualCode += `\n--- ENTRY FILE: ${mainFile} ---\n${Buffer.from(content.content, 'base64').toString().split('\n').slice(0, 50).join('\n')}`;
        }
        for (const file of securityConfigs) {
            const { data: content } = await octokit.rest.repos.getContent({
                owner: project.owner, repo: project.name, path: file
            });
            contextualCode += `\n--- CONFIG FILE: ${file} ---\n${Buffer.from(content.content, 'base64').toString()}`;
        }
        listAvailableModels();


        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
        }, { apiVersion: 'v1' });
        const prompt = `
        You are a Senior DevOps Engineer. Analyze this repository structure:
        Repository Name: ${project.name}
        Files: ${fileList.join(', ')}
        .gitignore: ${gitignoreContent}
        Entry Code (first 50 lines):
        ${entryCodeSnippet}
        CODE CONTEXT (Read this before flagging security issues):
        ${contextualCode}


        STRICT AUDIT RULES:
      - SECRETS: Only flag if you see a LITERAL string assigned to a variable (e.g. key="123"). If it uses 'process.env', it is SAFE.
      - CORS: If you do not see a explicit 'origin: "*"' or similar weak policy in the provided files, assume it is handled by the cloud provider and DO NOT flag it. Give a score of 10.
      - HEADERS: If this is a Next.js/Vercel project, assume security headers are handled at the edge unless you see evidence of them being disabled. Give a score of 10.
      - Don't make false claims. If you don't see an issue, give a high security score.
      

        Tasks:
        1. Identify the primary programming language.
        2. Check for security issues (e.g., is .env in the file list but NOT in .gitignore?).
        3. Security Heatmap: Rate (0-10, where 10 is very safe) the following:
         - 'secrets': Check for hardcoded keys/tokens in the snippet.
         - 'cors': Check for "origin: *" or weak CORS.
         - 'headers': Check for 'helmet' or security headers.
        4. Cloud Architect: Predict monthly cost on Railway/AWS and suggest scaling tier.
        5. Identify missing production files (Dockerfile, GitHub Actions).
        6. Suggest the best deployment platform (Vercel, AWS, Railway) and explain why.
        7. Calculate a production readiness score (0-100).
        8. Provide pseudocode for a Dockerfile and a GitHub Actions CI/CD pipeline.

        RESPONSE FORMAT: Strict JSON only.
        {
          "language": "string",
          "productionScore": number,
          "securityAlerts": ["alert1", "alert2"],
          "securityHeatmap": { "secrets": number, "cors": number, "headers": number },
          "costAnalysis": { "estimatedMonthly": number, "tier": "string", "reason": "string" },
          "missingFiles": ["file1"],
          "deploymentTip": "string",
          "optimizationTips": "string",
          "dockerfile": "string",
          "cicd": "string"
        }
      `;

        const result = await model.generateContent(prompt);
        console.log('result is :', result);
        const responseText = result.response.text().replace(/```json|```/g, "");
        console.log('responseText is :', responseText);
        const aiData = JSON.parse(responseText);
        console.log('aiData is :', aiData);

        project.productionScore = aiData.productionScore;
        project.lastScan = new Date();
        await project.save();

        const report = await Report.findOneAndUpdate(
            { repoId: project.repoId },
            {
                userId: project.userId,
                ...aiData,
                generatedFiles: {
                    dockerfile: aiData.dockerfile,
                    cicd: aiData.cicd
                }
            },
            { upsert: true, new: true }
        );

        res.json({ success: true, report });
    } catch (err) {
        console.error("AI Analysis Error:", err);
        res.status(500).json({ error: "Failed to perform AI analysis" });
    }
}

async function searchRepos(req, res) {
    const { githubId, query } = req.query;

    try {
        const user = await User.findOne({ githubId: String(githubId) });

        if (!user) {
            return res.status(404).json({ error: "User not found in database" });
        }

        if (!user.accessToken) {
            return res.status(401).json({ error: "No GitHub access token found." });
        }

        const Octokit = await getOctokit();
        const octokit = new Octokit({ auth: user.accessToken });

        const { data: viewer } = await octokit.rest.users.getAuthenticated();
        const username = viewer.login;

        const { data } = await octokit.rest.search.repos({
            q: `${query || ''} user:${username}`,
            sort: 'updated',
            per_page: 10,
        });

        res.json(data.items);
    } catch (err) {
        console.error("GitHub Search Error:", err.message);
        res.status(500).json({ error: "GitHub search failed", details: err.message });
    }
}

async function importRepo(req, res) {
    try {
        const { userId, repoData } = req.body;

        const existingProject = await Project.findOne({
            userId,
            repoId: repoData.repoId
        });

        if (existingProject) {
            return res.status(400).json({ error: "Project already imported" });
        }

        const newProject = new Project({
            userId: userId,
            repoId: repoData.repoId,
            name: repoData.name,
            owner: repoData.owner,
            description: repoData.description,
            language: repoData.language,
            stars: repoData.stars,
            htmlUrl: repoData.htmlUrl,
            productionScore: repoData.productionScore || 0,
            lastScan: repoData.lastScan || Date.now()
        });

        await newProject.save();

        res.status(201).json(newProject);
    } catch (err) {
        console.error("Import error:", err);
        res.status(500).json({ error: "Failed to import project" });
    }
}

async function getProjects(req, res) {
    const { githubId } = req.params;
    try {
        const projects = await Project.find({ userId: githubId });
        if (!projects) {
            return res.status(404).json([]);
        }
        res.json(projects);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch projects" });
    }
}

module.exports = {
    analyzeRepo,
    searchRepos,
    importRepo,
    getProjects
};
