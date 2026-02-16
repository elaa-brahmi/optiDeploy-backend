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
        9. Cloud Cost Optimizer: Based on the Dockerfile you generated, suggest specific CPU and Memory resource limits and requests for a production container (e.g., 512Mi RAM, 0.5 vCPU).

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
          "cicd": "string",
          "resourceOptimizer": {
            "cpuLimit": "string",
            "memoryLimit": "string",
            "cpuRequest": "string",
            "memoryRequest": "string",
            "explanation": "string"
            }
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
                },
                resourceOptimizer: aiData.resourceOptimizer
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
async function generatePR(req, res) {
    const { repoId } = req.params;

    try {
        // 1. Fetch Project and Report Data
        const project = await Project.findOne({ repoId });
        const report = await Report.findOne({ repoId });

        if (!project || !report) {
            return res.status(404).json({ error: "Analysis data not found. Please run a scan first." });
        }

        // 2. Initialize Octokit
        const user = await User.findOne({ githubId: project.userId });
        if (!user || !user.accessToken) {
            return res.status(401).json({ error: "User authentication failed." });
        }

        const Octokit = await getOctokit();
        const octokit = new Octokit({ auth: user.accessToken });
        const { owner, name: repo } = project;

        console.log(`Creating PR for ${owner}/${repo}`);

        // 3. Get repo info
        const { data: repoData } = await octokit.rest.repos.get({ owner, repo });
        console.log('✓ Repo accessible:', repoData.full_name);

        if (!repoData.permissions.push) {
            return res.status(403).json({
                error: "You don't have write access to this repository"
            });
        }

        const defaultBranch = repoData.default_branch;
        console.log(`Default branch: ${defaultBranch}`);

        // 4. Create a unique branch name
        const newBranchName = `optideploy-setup-${Date.now()}`;

        // 5. Get the default branch SHA
        const { data: ref } = await octokit.rest.git.getRef({
            owner,
            repo,
            ref: `heads/${defaultBranch}`
        });

        const baseSha = ref.object.sha;
        console.log(`Base SHA: ${baseSha}`);

        // 6. Create new branch from default branch
        await octokit.rest.git.createRef({
            owner,
            repo,
            ref: `refs/heads/${newBranchName}`,
            sha: baseSha
        });
        console.log(`✓ Branch created: ${newBranchName}`);

        // Wait for branch to initialize
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Helper function to get file SHA if it exists
        const getFileSha = async (path) => {
            try {
                const { data } = await octokit.rest.repos.getContent({
                    owner,
                    repo,
                    path,
                    ref: newBranchName
                });
                return Array.isArray(data) ? null : data.sha;
            } catch (err) {
                if (err.status === 404) {
                    return null;
                }
                throw err;
            }
        };

        // 7. Create or update Dockerfile
        const dockerfileSha = await getFileSha('Dockerfile');
        const dockerfileParams = {
            owner,
            repo,
            path: 'Dockerfile',
            message: dockerfileSha ? '🐳 Update Dockerfile' : '🐳 Add optimized Dockerfile',
            content: Buffer.from(report.generatedFiles.dockerfile).toString('base64'),
            branch: newBranchName
        };

        if (dockerfileSha) {
            dockerfileParams.sha = dockerfileSha;
            console.log('Dockerfile exists, will update it');
        }

        await octokit.rest.repos.createOrUpdateFileContents(dockerfileParams);
        console.log('✓ Dockerfile created/updated');

        // 8. Debug: Check what's actually in .github/workflows on the new branch
        try {
            const { data: workflowsContent } = await octokit.rest.repos.getContent({
                owner,
                repo,
                path: '.github/workflows',
                ref: newBranchName
            });
            console.log('Contents of .github/workflows:', Array.isArray(workflowsContent)
                ? workflowsContent.map(f => f.name)
                : 'Not a directory');
        } catch (err) {
            console.log('.github/workflows check error:', err.status, err.message);
        }

        // 9. First, create a dummy file in workflows to ensure the directory is writable
        console.log('Creating dummy file to initialize directory...');
        try {
            await octokit.rest.repos.createOrUpdateFileContents({
                owner,
                repo,
                path: '.github/workflows/.optideploy-temp',
                message: 'temp: initialize directory',
                content: Buffer.from('temp').toString('base64'),
                branch: newBranchName
            });
            console.log('✓ Dummy file created');

            // Wait a bit
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (tempErr) {
            console.log('Dummy file creation error:', tempErr.status, tempErr.message);
            // Continue anyway
        }

        // 10. Now try to create the workflow file
        const workflowSha = await getFileSha('.github/workflows/optideploy-ci.yml');
        const workflowParams = {
            owner,
            repo,
            path: '.github/workflows/optideploy-ci.yml',
            message: workflowSha ? '🚀 Update CI/CD pipeline' : '🚀 Add CI/CD pipeline',
            content: Buffer.from(report.generatedFiles.cicd).toString('base64'),
            branch: newBranchName
        };

        if (workflowSha) {
            workflowParams.sha = workflowSha;
            console.log('Workflow file exists, will update it');
        }

        console.log('Creating/updating CI/CD workflow file...');
        await octokit.rest.repos.createOrUpdateFileContents(workflowParams);
        console.log('✓ CI/CD workflow created/updated');

        // 11. Delete the dummy file
        try {
            const dummySha = await getFileSha('.github/workflows/.optideploy-temp');
            if (dummySha) {
                await octokit.rest.repos.deleteFile({
                    owner,
                    repo,
                    path: '.github/workflows/.optideploy-temp',
                    message: 'temp: cleanup',
                    sha: dummySha,
                    branch: newBranchName
                });
                console.log('✓ Dummy file deleted');
            }
        } catch (cleanupErr) {
            console.log('Cleanup error (non-fatal):', cleanupErr.message);
        }

        // 12. Open the Pull Request
        const { data: pr } = await octokit.rest.pulls.create({
            owner,
            repo,
            title: '🚀 OptiDeploy: Production Readiness Setup',
            head: newBranchName,
            base: defaultBranch,
            body: `### 🚀 Automated DevOps Setup

I noticed your repository was missing a few production-ready files. Based on my analysis, I've generated the following:

1. **Dockerfile**: Optimized for your ${report.language} stack.
2. **GitHub Actions**: Automated build and cache-optimized pipeline.

Review the changes and merge to improve your Production Score!

---
*Generated by [OptiDeploy](https://optideploy.com)*`
        });

        console.log(`✓ PR created: ${pr.html_url}`);

        res.json({
            success: true,
            prUrl: pr.html_url,
            prNumber: pr.number,
            message: "Pull Request created successfully!"
        });

    } catch (err) {
        console.error("PR Generation Error:", err.message);
        console.error("Status:", err.status);

        if (err.status === 404) {
            return res.status(404).json({
                error: "Repository or resource not found.",
                details: err.message
            });
        }

        if (err.status === 403) {
            return res.status(403).json({
                error: "Permission denied.",
                details: err.message
            });
        }

        if (err.status === 422) {
            return res.status(422).json({
                error: "Validation failed.",
                details: err.message
            });
        }

        res.status(500).json({
            error: err.message || "Failed to create Pull Request",
            status: err.status
        });
    }
}
async function generateIaC(req, res) {
    const { repoId } = req.params;
    const { provider } = req.body; // 'aws', 'azure', or 'gcp'

    try {
        const project = await Project.findOne({ repoId });
        const report = await Report.findOne({ repoId });
        const user = await User.findOne({ githubId: project.userId });

        if (!project || !report) {
            return res.status(404).json({ error: "Analysis not found." });
        }

        const Octokit = await getOctokit();
        const octokit = new Octokit({ auth: user.accessToken });

        // 1. Fetch package.json or equivalent for dependency context
        let manifestContent = "";
        try {
            const { data: pkg } = await octokit.rest.repos.getContent({
                owner: project.owner, repo: project.name, path: 'package.json' 
            });
            manifestContent = Buffer.from(pkg.content, 'base64').toString();
        } catch (e) {
            manifestContent = "No manifest found.";
        }

        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        const prompt = `
        You are a Staff Cloud Architect and DevSecOps Specialist. 
        Generate a high-performance, secure, and production-ready Terraform 'main.tf' for ${provider.toUpperCase()}.

        PROJECT CONTEXT:
        - Language: ${report.language}
        - Dockerfile: ${report.generatedFiles.dockerfile}
        - Dependencies: ${manifestContent}
        - Detected Vulnerabilities to avoid: ${report.securityAlerts.join(', ')}

        MANDATORY ARCHITECTURE CONSTRAINTS:
        1. IDENTITY & ACCESS: Use System-Assigned Managed Identity. NO hardcoded service principal keys.
        2. SECRET MANAGEMENT: All sensitive strings (DB strings, API keys) MUST be stored in a Key Vault (Azure), Secret Manager (AWS/GCP), or Parameter Store. Reference these secrets by ID in the container service.
        3. NETWORKING: 
           - Provision a VPC/VNet with at least 2 subnets.
           - Place Databases/Caches in a Private Subnet.
           - Use Private Endpoints/Link for DB-to-App communication.
        4. RESOURCE NAMING: Use the 'random' provider (random_string) to prevent naming collisions for global resources like Storage or Container Registries.
        5. CONTAINER CONFIG:
           - Configure health checks (liveness/readiness) based on the Dockerfile EXPOSE port.
           - Set CPU/Memory limits to: CPU ${report.resourceOptimizer?.cpuLimit || '0.5'}, RAM ${report.resourceOptimizer?.memoryLimit || '1Gi'}.
        6. DATABASE:
           - If dependencies contain 'mongoose' or 'mongodb', provision a Serverless/Autoscale CosmosDB (Azure) or DocumentDB (AWS).
           - If 'pg' or 'sequelize', provision a Managed SQL instance.

        TASKS:
        1. Generate complete HCL code with variables and outputs.
        2. Include the 'random' provider to ensure unique resource names.
        3. Use locals to manage tags and naming conventions cleanly.

        OUTPUT FORMAT: Return JSON only. No prose outside the JSON.
        {
          "terraformCode": "string (HCL)",
          "explanation": "Summarize the security (Key Vault, Private Links) and cost choices.",
          "deploymentSteps": ["step 1: terraform init", "step 2...", "Note: Ensure you have contributor access to the subscription."],
          "cloudResources": ["Azure Container Apps", "Key Vault", "CosmosDB", "VNet"]
        }
        `;

        const result = await model.generateContent(prompt);
        const iacData = JSON.parse(result.response.text().replace(/```json|```/g, ""));

        // Save to specific provider slot
        const update = {};
        update[`iacConfigurations.${provider}`] = iacData;
        await Report.findOneAndUpdate({ repoId }, { $set: update });

        res.json({ success: true, iac: iacData });
    } catch (err) {
        res.status(500).json({ error: "IaC Generation failed" });
    }
}
module.exports = {
    analyzeRepo,
    searchRepos,
    importRepo,
    getProjects,
    generatePR,
    generateIaC
};
