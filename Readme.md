
# SFMC Data Extension Form Integration

A simple Node.js and Express application that submits contact form
data to a Salesforce Marketing Cloud Data Extension.

## Features

- SFMC OAuth 2.0 client credentials authentication
- Access token caching
- HTML contact form
- Server-side input validation
- SFMC Data Extension REST API integration
- Render deployment configuration

## Requirements

- Node.js 20 or newer
- Salesforce Marketing Cloud Installed Package
- API integration permissions
- Target Business Unit MID
- Data Extension External Key

## Configure the Data Extension

Create a Data Extension with these fields:

| Field | Type | Required |
|---|---|---|
| Name | Text (100) | Yes |
| Email | EmailAddress (254) | Yes |
| Phone | Text (30) | No |

Ensure any additional required fields and primary keys are
also provided by the application.

## Local setup

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env`.
3. Fill in the actual SFMC credentials and URLs.
4. Install dependencies:

   npm install

5. Start the server:

   npm start

6. Open http://localhost:3000

Never commit `.env` to GitHub.

## Deploy to Render

1. Push this project to a GitHub repository.
2. Sign in to Render and create a new Blueprint.
3. Connect your GitHub repository and deploy `render.yaml`.
4. Set the SFMC environment variables in the Render dashboard.
5. Redeploy if prompted.
6. Open the deployed application URL and test the form.

## API endpoints

GET /api/health
POST /api/submit

## Important

The asynchronous SFMC endpoint accepts requests for processing.
A successful HTTP response does not by itself prove that the
row has been stored. Verify asynchronous processing and the
resulting Data Extension row in Marketing Cloud.

Keep credentials on the server, use HTTPS, and implement suitable
rate limiting and abuse protection before public production use.
