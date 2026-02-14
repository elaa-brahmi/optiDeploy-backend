const express = require('express');
const router = express.Router();
const User = require('../models/user');
const Project = require('../models/repo');
const Report = require('../models/report');
const { GoogleGenerativeAI } = require("@google/generative-ai");
// Lazy-load Octokit via dynamic import because @octokit/rest is ESM-only
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
      // Note: The ListModels method is usually on the root genAI object or via the v1 endpoint
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
  
  
router.post('/analyze/:repoId', async (req, res) => {
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
    const entryPoints = ['index.js', 'app.js', 'server.js', 'main.py', 'src/index.ts', 'server.ts','app/page.tsx','middleware.ts'];
    const mainFile = fileList.find(name => entryPoints.includes(name));
    let entryCodeSnippet = "No entry file found for code analysis.";

    if (mainFile) {
      const { data: content } = await octokit.rest.repos.getContent({
        owner: project.owner, repo: project.name, path: mainFile
      });
      const decodedCode = Buffer.from(content.content, 'base64').toString();
      entryCodeSnippet = decodedCode.split('\n').slice(0, 50).join('\n');
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
      console.log('result is :',result);
      const responseText = result.response.text().replace(/```json|```/g, "");
      console.log('responseText is :',responseText);
      const aiData = JSON.parse(responseText);
      console.log('aiData is :',aiData);
  
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
  });
router.get('/search', async (req, res) => {
    const { githubId, query } = req.query;
  
    try {
      const user = await User.findOne({ githubId: String(githubId) });
      
      if (!user) {
        return res.status(404).json({ error: "User not found in database" });
      }

      if (!user.accessToken) {
        return res.status(401).json({ error: "No GitHub access token found." });
      }

      // --- FIX: Await the helper to get the Octokit constructor ---
      const Octokit = await getOctokit(); 
      const octokit = new Octokit({ auth: user.accessToken });
  
      // Get actual username to ensure the search 'q' is valid
      const { data: viewer } = await octokit.rest.users.getAuthenticated();
      const username = viewer.login;

      const { data } = await octokit.rest.search.repos({
        // Proper GitHub search syntax: "query user:username"
        q: `${query || ''} user:${username}`, 
        sort: 'updated',
        per_page: 10,
      });
  
      res.json(data.items);
    } catch (err) {
      console.error("GitHub Search Error:", err.message);
      res.status(500).json({ error: "GitHub search failed", details: err.message });
    }
});
router.post('/import', async (req, res) => {
    try {
      const { userId, repoData } = req.body;
  
      //check if project already exists
      const existingProject = await Project.findOne({ 
        userId, 
        repoId: repoData.repoId 
      });
  
      if (existingProject) {
        return res.status(400).json({ error: "Project already imported" });
      }
  
      //create new project
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
  });
//fetch users projects
router.get('/projects/:githubId', async (req, res) => {
  const { githubId } = req.params;
  try {
    const projects = await Project.find({ userId: githubId });
    if(!projects) {
      return res.status(404).json([]);
    }
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});


router.get('/report/:repoId', async (req, res) => {
    try {
      const report = await Report.findOne({ repoId: req.params.repoId });
      res.json(report);
    } catch (err) {
      res.status(500).json({ error: "Report not found" });
    }
  });

module.exports = router;