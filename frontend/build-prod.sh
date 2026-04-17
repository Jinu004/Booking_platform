#!/bin/bash
echo "Building BookingAI frontend for production..."

# Set production environment
export VITE_API_URL=http://140.245.247.48/api/v1
export VITE_BYPASS_AUTH=false

# Install dependencies
npm install

# Build
npm run build

echo "Build complete. Files in dist/ folder."
echo "Upload dist/ contents to Oracle VM:"
echo "scp -r dist/* ubuntu@140.245.247.48:/var/www/booking-platform/frontend/"
