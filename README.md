# JKC Construction Backend API

A Node.js/Express backend API for the JKC Construction website with email integration, file uploads, and form handling.

## Features

- **Contact Form API** - Handle contact form submissions with email notifications
- **Career Applications** - Talent network registration and job listings
- **File Upload** - Resume upload functionality with validation
- **Email Integration** - Nodemailer for sending notifications
- **Security** - Rate limiting, CORS, input validation, and helmet security headers
- **Database Ready** - MongoDB integration ready (optional)

## Quick Start

### 1. Install Dependencies
```bash
cd backend
npm install
```

### 2. Environment Setup
```bash
cp .env.example .env
```

Edit `.env` file with your configuration:
```env
# Server
PORT=5000
NODE_ENV=development

# Email (Gmail example)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
EMAIL_TO=jaykrishna.surat@gmail.com

# Frontend URL
CORS_ORIGIN=http://jaykrishnaconstruction.in
```

### 3. Start Server
```bash
# Development
npm run dev

# Production
npm start
```

## API Endpoints

### Health Check
- `GET /api/health` - Server status

### Contact Form
- `POST /api/contact` - Submit contact form
- `GET /api/contact/test` - Test email configuration

### Careers
- `POST /api/careers/talent-network` - Join talent network
- `GET /api/careers/jobs` - Get job listings
- `GET /api/careers/jobs/:id` - Get specific job details

### File Upload
- `POST /api/upload/resume` - Upload resume
- `GET /api/upload/files/:filename` - Download file (admin)

## Email Configuration

### Gmail Setup
1. Enable 2-factor authentication
2. Generate an App Password
3. Use the App Password in `EMAIL_PASS`

### Other Providers
Update `EMAIL_HOST` and `EMAIL_PORT` accordingly:
- **Outlook**: smtp-mail.outlook.com:587
- **Yahoo**: smtp.mail.yahoo.com:587

## Security Features

- Rate limiting (contact: 5/15min, careers: 3/hour, uploads: 5/hour)
- Input validation and sanitization
- CORS protection
- Helmet security headers
- File type validation
- File size limits (5MB default)

## Database Integration (Optional)

The server supports MongoDB for storing submissions:

```bash
# Install MongoDB locally or use MongoDB Atlas
MONGODB_URI=mongodb://localhost:27017/jkc_construction
```

## File Structure

```
backend/
├── routes/
│   ├── contact.js      # Contact form handling
│   ├── careers.js      # Career applications
│   └── upload.js       # File upload handling
├── uploads/            # Uploaded files storage
├── server.js           # Main server file
├── package.json        # Dependencies
├── .env.example        # Environment template
└── README.md          # This file
```

## Frontend Integration

Update your React frontend to use the backend API:

```javascript
// Contact form submission
const response = await fetch('http://jaykrishnaconstruction.in/api/contact', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(formData)
});
```

## Production Deployment

1. Set `NODE_ENV=development`
2. Use a process manager (PM2)
3. Set up reverse proxy (Nginx)
4. Configure SSL certificates
5. Use a production database

## Troubleshooting

### Email Not Working
- Check email credentials
- Verify App Password (Gmail)
- Test with `GET /api/contact/test`

### File Upload Issues
- Check file size limits
- Verify file types allowed
- Ensure uploads directory exists

### CORS Errors
- Update `CORS_ORIGIN` in .env
- Match your frontend URL exactly

## Support

For issues or questions, contact: jaykrishna.surat@gmail.com
