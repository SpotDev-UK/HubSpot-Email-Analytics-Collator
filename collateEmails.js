const axios = require('axios');
const fileSystem = require("fs");
const filePath = require("path");

// For testing purposes, limit the size of the data fetched from the events endpoint
const testMode = false;
const testEventLimit = 1000;

// Read variables from the configuration file
const variables = JSON.parse(
	fileSystem.readFileSync(filePath.join(__dirname, "variables.json"), "utf8")
);

// Configuration object
const configuration = {
	hubSpotAccessToken: variables.hubspotAccessToken,
	baseUniformResourceLocator: "https://api.hubapi.com",
	outputDirectory: "./hubspot_analytics",
	batchLimit: 100,
	salesforceSendsDirectory: "./salesforce_sends",
	salesforceIntegrationUserIdentifier: variables.salesforceIntegrationUserId,
};

// Endpoints
const endpoints = {
	emailEventsVersionOne: "/email/public/v1/events",
	emailCampaignVersionOne: "/email/public/v1/campaigns",
	emailContentVersionOne: "/marketing-emails/v1/emails/with-statistics",
	marketingEmailsVersionThree: "/marketing/v3/emails",
};

// Create an Axios instance with default configuration
function createAxiosInstance() {
	return axios.create({
		baseURL: configuration.baseUniformResourceLocator,
		headers: {
			Authorization: `Bearer ${configuration.hubSpotAccessToken}`,
			"Content-Type": "application/json",
		},
	});
}

// Ensure the output directory exists
function ensureOutputDirectoryExists() {
	if (!fileSystem.existsSync(configuration.outputDirectory)) {
		fileSystem.mkdirSync(configuration.outputDirectory, { recursive: true });
	}
}

// Ensure the salesforce_sends directory exists
function ensureSalesforceSendsDirectoryExists() {
	if (!fileSystem.existsSync(configuration.salesforceSendsDirectory)) {
		fileSystem.mkdirSync(configuration.salesforceSendsDirectory, {
			recursive: true,
		});
	}
}

// Fetch all HubSpot email events
async function getAllEvents() {
	const applicationProgrammingInterface = createAxiosInstance();
	let allEvents = [];
	let hasMoreEvents = true;
	let nextOffset = undefined;

	console.log("Fetching all email events...");

	while (hasMoreEvents) {
		try {
			const parameters = {
				limit: configuration.batchLimit,
				...(nextOffset && { offset: nextOffset }),
			};

			const response = await applicationProgrammingInterface.get(
				endpoints.emailEventsVersionOne,
				{ params: parameters }
			);
			const { events, hasMore, offset } = response.data;

			if (events && events.length > 0) {
				allEvents = allEvents.concat(events);
				console.log(
					`Fetched ${events.length} events. Total so far: ${allEvents.length}`
				);

				if (testMode && allEvents.length >= testEventLimit) {
					console.log(`Test mode: Reached limit of ${testEventLimit} events`);
					hasMoreEvents = false;
					break;
				}
			}

			hasMoreEvents = hasMore;
			nextOffset = offset;
		} catch (error) {
			console.error("Error fetching events:", error.message);
			hasMoreEvents = false;
		}
	}

	return allEvents;
}

// Fetch detailed campaign information from HubSpot
async function getEmailCampaignDetails(campaignIdentifier) {
	const applicationProgrammingInterface = createAxiosInstance();
	try {
		const response = await applicationProgrammingInterface.get(
			`${endpoints.emailCampaignVersionOne}/${campaignIdentifier}`
		);
		return response.data;
	} catch (error) {
		console.error(
			`Error fetching campaign details for ${campaignIdentifier}:`,
			error.message
		);
		return null;
	}
}

// Fetch detailed content information about the marketing email
async function getEmailContent(contentIdentifier) {
	const applicationProgrammingInterface = createAxiosInstance();
	try {
		const response = await applicationProgrammingInterface.get(
			`${endpoints.emailContentVersionOne}/${contentIdentifier}`,
			{
				params: {
					includeStats: true,
					marketingCampaignNames: true,
					workflowName: true,
				},
			}
		);
		return response.data;
	} catch (error) {
		console.error(
			`Error fetching email content for ${contentIdentifier}:`,
			error.message
		);
		return null;
	}
}

// Process events for a single campaign to determine engagement and recipients.
// We will also store the ID of the SENT/DELIVERED/PROCESSED event that "introduced" the recipient.
// This event ID will be used as HubSpot_Email_Send_ID__c.
function processEmailEvents(campaignIdentifier, allEvents) {
	const emailEvents = allEvents.filter(
		(event) => event.emailCampaignId === campaignIdentifier
	);

	const openedRecipientsSet = new Set();
	const clickedRecipientsSet = new Set();
	const unsubscribedRecipientsSet = new Set();
	const sentToRecipientsSet = new Set();

	// For storing the send event ID per recipient
	const sendEventIds = {};

	emailEvents.forEach((event) => {
		const recipientEmailAddress = event.recipient;
		const eventType = event.type;

		// Identify sent-related events
		// For example: SENT, DELIVERED, PROCESSED are typically "sending" events
		// We will use the first such event to get the HubSpot_Email_Send_ID__c
		if (
			eventType === "SENT" ||
			eventType === "DELIVERED" ||
			eventType === "PROCESSED"
		) {
			sentToRecipientsSet.add(recipientEmailAddress);
			// If we have not already recorded a send ID for this recipient, record it now
			if (!sendEventIds[recipientEmailAddress]) {
				sendEventIds[recipientEmailAddress] = event.id;
			}
		}

		// Track engagement
		switch (eventType) {
			case "OPEN":
				openedRecipientsSet.add(recipientEmailAddress);
				break;
			case "CLICK":
				clickedRecipientsSet.add(recipientEmailAddress);
				break;
			case "UNSUBSCRIBE":
				unsubscribedRecipientsSet.add(recipientEmailAddress);
				break;
		}
	});

	return {
		opens: Array.from(openedRecipientsSet),
		clicks: Array.from(clickedRecipientsSet),
		unsubscribes: Array.from(unsubscribedRecipientsSet),
		sentTo: Array.from(sentToRecipientsSet),
		allEvents: emailEvents,
		sendEventIds: sendEventIds,
	};
}

// This function determines if a HubSpot contact is a Salesforce Contact or Lead by simulating that lookup.
// For this example, we will not actually call Salesforce since we are no longer sending data to Salesforce.
// Instead, we will simulate the logic that if the email contains "lead" then assume a Lead, else assume a Contact.
async function determineIfHubSpotContactIsSalesforceContactOrLead(
	emailAddress
) {
	if (emailAddress.toLowerCase().includes("lead")) {
		return { type: "Lead", recordIdentifier: "00Q_simulatedLeadId" };
	} else {
		return { type: "Contact", recordIdentifier: "003_simulatedContactId" };
	}
}

// Instead of posting to Salesforce, we will write the payload to a JSON file in the salesforce_sends directory.
// Now we will use the event ID from the sent event (if available) as HubSpot_Email_Send_ID__c.
async function writeSalesforceSendPayloadToFile(parameters) {
	const {
		salesforceContactOrLeadType,
		salesforceRecordIdentifier,
		recipient,
		campaignIdentifier,
		hubSpotSendIdentifier,
		opened,
		clicked,
		unsubscribed,
	} = parameters;

	// Map fields to what would have been sent to Salesforce
	const recordData = {
		Contact__c:
			salesforceContactOrLeadType === "Contact"
				? salesforceRecordIdentifier
				: null,
		Lead__c:
			salesforceContactOrLeadType === "Lead"
				? salesforceRecordIdentifier
				: null,
		CreatedById: configuration.salesforceIntegrationUserIdentifier,
		Email_Address__c: recipient,
		HubSpot_Email_Campaign__c: campaignIdentifier,
		HubSpot_Email_Send_ID__c: hubSpotSendIdentifier || "N/A",
		Total_Clicks__c: clicked ? 1 : 0,
		Total_Opened__c: opened ? 1 : 0,
		Total_Replies__c: 0,
		Unsubscribed__c: unsubscribed ? true : false,
	};

	// Ensure the directory exists
	ensureSalesforceSendsDirectoryExists();

	// Create a file name for this particular send
	const safeRecipient = recipient.replace(/[^a-zA-Z0-9_.-]/g, "_");
	const fileName = filePath.join(
		configuration.salesforceSendsDirectory,
		`send_${campaignIdentifier}_${safeRecipient}.json`
	);

	fileSystem.writeFileSync(fileName, JSON.stringify(recordData, null, 2));
	console.log(`Wrote Salesforce send payload to file: ${fileName}`);
}

// After compiling analytics, this function simulates sending each "email send" record to Salesforce by writing JSON files.
// We will now use the sendEventIds from the analysis to assign HubSpot_Email_Send_ID__c correctly.
async function writeAllEmailSendsToFiles(analysisResults) {
	for (const campaignAnalysis of analysisResults) {
		const campaignIdentifier = campaignAnalysis.id;
		// Retrieve the map of recipient -> send event ID
		const sendEventIds = campaignAnalysis.sendEventIds || {};

		for (const recipient of campaignAnalysis.sentTo) {
			// Determine engagement flags for this recipient
			const opened = campaignAnalysis.engagement.opens.includes(recipient);
			const clicked = campaignAnalysis.engagement.clicks.includes(recipient);
			const unsubscribed =
				campaignAnalysis.engagement.unsubscribes.includes(recipient);

			// Use the event ID from the sent events as the HubSpot_Email_Send_ID__c
			const hubSpotSendIdentifier = sendEventIds[recipient] || "N/A";

			// Determine if this recipient maps to a Salesforce Contact or Lead
			const salesforceRecord =
				await determineIfHubSpotContactIsSalesforceContactOrLead(recipient);
			if (!salesforceRecord) {
				console.warn(
					`No matching Salesforce record found for ${recipient}, skipping.`
				);
				continue;
			}

			// Write the JSON file that represents the payload
			await writeSalesforceSendPayloadToFile({
				salesforceContactOrLeadType: salesforceRecord.type,
				salesforceRecordIdentifier: salesforceRecord.recordIdentifier,
				recipient: recipient,
				campaignIdentifier: campaignIdentifier,
				hubSpotSendIdentifier: hubSpotSendIdentifier,
				opened: opened,
				clicked: clicked,
				unsubscribed: unsubscribed,
			});
		}
	}
}

// Compile email analytics from all events, save them locally, and then write send payloads to files
async function compileEmailAnalytics() {
	ensureOutputDirectoryExists();

	try {
		// Get all HubSpot email events
		const allEvents = await getAllEvents();

		// Extract unique campaign identifiers
		const campaignIdentifiers = [
			...new Set(allEvents.map((event) => event.emailCampaignId)),
		];

		const results = [];
		for (const campaignIdentifier of campaignIdentifiers) {
			console.log(`Processing campaign: ${campaignIdentifier}`);

			// Fetch campaign details
			const campaignDetails = await getEmailCampaignDetails(campaignIdentifier);
			if (!campaignDetails) continue;

			// Fetch content details if available
			const contentDetails = campaignDetails.contentId
				? await getEmailContent(campaignDetails.contentId)
				: null;

			// Process events to determine engagement and recipients
			const eventData = processEmailEvents(campaignIdentifier, allEvents);

			// Prepare the analysis object
			const analysis = {
				id: campaignIdentifier,
				campaign: campaignDetails,
				content: contentDetails,
				engagement: {
					opens: eventData.opens,
					clicks: eventData.clicks,
					unsubscribes: eventData.unsubscribes,
				},
				sentTo: eventData.sentTo,
				sendEventIds: eventData.sendEventIds,
			};

			results.push(analysis);

			// Save individual campaign data to a file
			const fileName = filePath.join(
				configuration.outputDirectory,
				`email_${campaignIdentifier}.json`
			);
			fileSystem.writeFileSync(fileName, JSON.stringify(analysis, null, 2));
			console.log(`Saved analysis for campaign ${campaignIdentifier}`);
		}

		// Save a summary file containing all campaigns
		const summaryFileName = filePath.join(
			configuration.outputDirectory,
			"email_analytics_summary.json"
		);
		fileSystem.writeFileSync(summaryFileName, JSON.stringify(results, null, 2));

		console.log(
			"Analysis complete! Results saved to:",
			configuration.outputDirectory
		);

		// Write all sends to files, using the event IDs as HubSpot_Email_Send_ID__c
		await writeAllEmailSendsToFiles(results);

		return results;
	} catch (error) {
		console.error("Error in email analytics compilation:", error);
		throw error;
	}
}

// If run directly (not imported as a module), execute the compileEmailAnalytics function
if (require.main === module) {
	compileEmailAnalytics()
		.then(() =>
			console.log("Email analytics compilation completed successfully")
		)
		.catch((error) => {
			console.error("Failed to compile email analytics:", error);
			process.exit(1);
		});
}

// Export functions if needed elsewhere
module.exports = {
	compileEmailAnalytics,
	getAllEvents,
	getEmailCampaignDetails,
	getEmailContent,
	processEmailEvents,
	determineIfHubSpotContactIsSalesforceContactOrLead,
	writeSalesforceSendPayloadToFile,
};