import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { handleIncomingSms, handleMissedCall } from './controllers/webhooks';
import { initCronJobs } from './services/cron';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
// Need express.urlencoded to parse Twilio webhooks specifically which are form-urlencoded
app.use(express.urlencoded({ extended: true }));
// Use JSON parser for regular API endpoints (if adding a dashboard API later)
app.use(express.json());

// Routes
app.get('/', (req, res) => {
    res.status(200).send('Highland Lake Customs API is Running 🚀');
});

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

import { markJobComplete } from './controllers/jobs';
import { manualSendSms } from './controllers/messages';
app.post('/api/jobs/:leadId/complete', markJobComplete);
app.post('/api/messages/send', manualSendSms);

// Twilio Webhooks
app.post('/api/webhooks/twilio/sms', handleIncomingSms);
app.post('/api/webhooks/twilio/missed-call', handleMissedCall);

// Start Server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    
    // Initialize background automations
    initCronJobs();
});
