const axios = require('axios');
const fs = require('fs');
const path = require('path');

// For testing purposes, limit the data size of the events endpoint
const testMode = false;
const testEventLimit = 1000;

// Read variables from JSON file
const variables = JSON.parse(fs.readFileSync(path.join(__dirname, 'variables.json'), 'utf8'));

// Configuration
const config = {
    apiKey: variables.hubspotAccessToken,
    baseUrl: 'https://api.hubapi.com',
    outputDir: './hubspot_analytics',
    batchSize: 100
};

const endpoints = {
    emailEventsV1: '/email/public/v1/events',
    emailCampaignV1: '/email/public/v1/campaigns',
    emailContentV1: '/marketing-emails/v1/emails/with-statistics',
    marketingEmailsV3: '/marketing/v3/emails'
};

// Create axios instance with default configuration
function createAxiosInstance() {
    return axios.create({
        baseURL: config.baseUrl,
        headers: {
            'Authorization': `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json'
        }
    });
}

// Ensure output directory exists
function ensureOutputDirectory() {
    if (!fs.existsSync(config.outputDir)) {
        fs.mkdirSync(config.outputDir, { recursive: true });
    }
}

async function getAllEvents() {
    const api = createAxiosInstance();
    let allEvents = [];
    let hasMore = true;
    let offset = undefined;

    console.log('Fetching all email events...');

    while (hasMore) {
        try {
            const params = {
                limit: config.batchSize,
                ...(offset && { offset })
            };

            const response = await api.get(endpoints.emailEventsV1, { params });
            const { events, hasMore: moreEvents, offset: newOffset } = response.data;

            if (events && events.length > 0) {
                allEvents = allEvents.concat(events);
                console.log(`Fetched ${events.length} events. Total: ${allEvents.length}`);
                
                if (testMode && allEvents.length >= testEventLimit) {
                    console.log(`Test mode: Reached limit of ${testEventLimit} events`);
                    hasMore = false;
                    break;
                }
            }

            hasMore = moreEvents;
            offset = newOffset;
        } catch (error) {
            console.error('Error fetching events:', error.message);
            hasMore = false;
        }
    }

    return allEvents;
}

async function getEmailCampaignDetails(campaignId) {
    const api = createAxiosInstance();
    try {
        const response = await api.get(`${endpoints.emailCampaignV1}/${campaignId}`);
        return response.data;
    } catch (error) {
        console.error(`Error fetching campaign details for ${campaignId}:`, error.message);
        return null;
    }
}

async function getEmailContent(contentId) {
    const api = createAxiosInstance();
    try {
        const response = await api.get(`${endpoints.emailContentV1}/${contentId}`, {
            params: {
                includeStats: true,
                marketingCampaignNames: true,
                workflowName: true
            }
        });
        return response.data;
    } catch (error) {
        console.error(`Error fetching email content for ${contentId}:`, error.message);
        return null;
    }
}

function processEmailEvents(campaignId, allEvents) {
    const emailEvents = allEvents.filter(event => event.emailCampaignId === campaignId);
    
    const openedBy = new Set();
    const clickedBy = new Set();
    const unsubscribedBy = new Set();

    emailEvents.forEach(event => {
        const recipient = event.recipient;
        switch (event.type) {
            case 'OPEN': openedBy.add(recipient); break;
            case 'CLICK': clickedBy.add(recipient); break;
            case 'UNSUBSCRIBE': unsubscribedBy.add(recipient); break;
        }
    });

    return {
        opens: Array.from(openedBy),
        clicks: Array.from(clickedBy),
        unsubscribes: Array.from(unsubscribedBy),
        allEvents: emailEvents
    };
}

async function compileEmailAnalytics() {
    ensureOutputDirectory();
    
    try {
        // 1. Get all events first
        const allEvents = await getAllEvents();
        
        // 2. Get unique campaign IDs from events
        const campaignIds = [...new Set(allEvents.map(event => event.emailCampaignId))];
        
        // 3. Process each campaign
        const results = [];
        for (const campaignId of campaignIds) {
            console.log(`Processing campaign: ${campaignId}`);
            
            // Get campaign details
            const campaignDetails = await getEmailCampaignDetails(campaignId);
            if (!campaignDetails) continue;

            // Get content details if available
            const contentDetails = campaignDetails.contentId ? 
                await getEmailContent(campaignDetails.contentId) : null;

            // Process events
            const eventData = processEmailEvents(campaignId, allEvents);
            
            // Combine all data
            const analysis = {
                id: campaignId,
                campaign: campaignDetails,
                content: contentDetails,
                engagement: {
                    opens: eventData.opens,
                    clicks: eventData.clicks,
                    unsubscribes: eventData.unsubscribes
                }
            };

            results.push(analysis);

            // Save individual campaign data
            const fileName = path.join(config.outputDir, `email_${campaignId}.json`);
            fs.writeFileSync(fileName, JSON.stringify(analysis, null, 2));
            console.log(`Saved analysis for campaign ${campaignId}`);
        }

        // Save summary file
        const summaryFileName = path.join(config.outputDir, 'email_analytics_summary.json');
        fs.writeFileSync(summaryFileName, JSON.stringify(results, null, 2));

        console.log('Analysis complete! Results saved to:', config.outputDir);
        return results;
    } catch (error) {
        console.error('Error in email analytics compilation:', error);
        throw error;
    }
}

// If running directly (not being imported as a module)
if (require.main === module) {
    compileEmailAnalytics()
        .then(() => console.log('Email analytics compilation completed successfully'))
        .catch(error => {
            console.error('Failed to compile email analytics:', error);
            process.exit(1);
        });
}

module.exports = {
    compileEmailAnalytics,
    getAllEvents,
    getEmailCampaignDetails,
    getEmailContent,
    processEmailEvents
};