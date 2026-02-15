dockerfile
# Use a lightweight Node.js base image
FROM node:18-alpine

# Set working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json first
# This step is cached by Docker, speeding up builds if dependencies don't change
COPY package*.json ./

# Install production dependencies
# Use 'npm ci' for clean install based on package-lock.json, faster and more reliable
RUN npm ci --only=production

# Copy the rest of the application code
COPY . .

# Expose the port the app runs on (defaulting to 3000 if not set in .env)
# This is for documentation; the actual port will be mapped by the orchestrator
EXPOSE 3000

# Define the command to run the application
# Assumes 'npm start' command is configured in package.json to run index.js
CMD ["npm", "start"]
