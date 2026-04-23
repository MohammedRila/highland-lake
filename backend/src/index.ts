import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { handleIncomingSms, handleMissedCall, handleMobileSms } from './controllers/webhooks';
import { initCronJobs } from './services/cron';
import { markJobComplete } from './controllers/jobs';
import { manualSendSms } from './controllers/messages';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Routes
app.get('/', (req, res) => {
    res.status(200).send('Highland Lake Customs API is Running 🚀');
});

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// API Routes
app.post('/api/jobs/:leadId/complete', markJobComplete);
app.post('/api/messages/send', manualSendSms);

// Webhooks
app.post('/api/webhooks/twilio/sms', handleIncomingSms);
app.post('/api/webhooks/twilio/missed-call', handleMissedCall);
app.post('/api/webhooks/mobile/sms', handleMobileSms);

// Start Server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    
    // Initialize background automations
    initCronJobs();
});
