# Use an official lightweight Node.js image
FROM node:24-alpine

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package files first to leverage Docker layer caching
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy the rest of the application source code
COPY . .

# Expose the application port (defaulting to 3000 as per server.js)
EXPOSE 3000

# Set environment variable for the port
ENV PORT=3000

# Start the application
CMD ["npm", "start"]
