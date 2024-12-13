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
	hubspotCampaign: "/marketing/v3/campaigns",
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

// Fetch the HubSpot campaign details (NEW function to handle campaign inclusion)
async function getHubSpotCampaign(campaignId) {
	const applicationProgrammingInterface = createAxiosInstance();
	try {
		const response = await applicationProgrammingInterface.get(
			`${endpoints.hubspotCampaign}/${campaignId}`
		);
		return response.data;
	} catch (error) {
		console.error(
			`Error fetching HubSpot campaign details for ${campaignId}:`,
			error.message
		);
		return null;
	}
}

// Process events for a single campaign to determine engagement and recipients.
// Will store counts of opens, clicks, replies, and unsubscribes per recipient.
// Also stores the ID of the SENT/DELIVERED/PROCESSED event that "introduced" the recipient.
function processEmailEvents(campaignIdentifier, allEvents) {
	const emailEvents = allEvents.filter(
		(event) => event.emailCampaignId === campaignIdentifier
	);

	// Initialize a map to store per-recipient event counts and info
	const recipientEventsMap = {};

	emailEvents.forEach((event) => {
		const recipientEmailAddress = event.recipient;
		const eventType = event.type;

		// Initialize recipient data if not already present
		if (!recipientEventsMap[recipientEmailAddress]) {
			recipientEventsMap[recipientEmailAddress] = {
				opens: 0,
				clicks: 0,
				replies: 0,
				unsubscribed: false,
				sendEventId: null,
			};
		}

		const recipientData = recipientEventsMap[recipientEmailAddress];

		// Identify sent-related events
		if (
			eventType === "SENT" ||
			eventType === "DELIVERED" ||
			eventType === "PROCESSED"
		) {
			if (!recipientData.sendEventId) {
				recipientData.sendEventId = event.id;
			}
		}

		// Track engagement
		switch (eventType) {
			case "OPEN":
				recipientData.opens += 1;
				break;
			case "CLICK":
				recipientData.clicks += 1;
				break;
			case "UNSUBSCRIBE":
				recipientData.unsubscribed = true;
				break;
			case "REPLY":
				recipientData.replies += 1;
				break;
		}
	});

	return recipientEventsMap;
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
		recipientData,
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
		Total_Clicks__c: recipientData.clicks || 0, // Using count of contact's clicks
		Total_Opened__c: recipientData.opens || 0, // Using count of contact's opens
		Total_Replies__c: recipientData.replies || 0, // Using count of contact's replies
		Unsubscribed__c: recipientData.unsubscribed, // Whether the contact unsubscribed
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
		const recipientEventsMap = campaignAnalysis.recipientEventsMap; // Access the recipient event data

		for (const recipient in recipientEventsMap) {
			const recipientData = recipientEventsMap[recipient];

			// Use the event ID from the sent events as the HubSpot_Email_Send_ID__c
			const hubSpotSendIdentifier = recipientData.sendEventId || "N/A";

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
				recipientData: recipientData, // Pass the recipient data
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

			let includeCampaign = true; // Flag to determine whether to include this campaign

			if (contentDetails && contentDetails.campaign) {
				const hubspotCampaignId = contentDetails.campaign;
				const hubspotCampaignDetails = await getHubSpotCampaign(
					hubspotCampaignId
				);
				if (hubspotCampaignDetails) {
					const updatedAt = new Date(hubspotCampaignDetails.updatedAt);
					const watermarkDate = new Date("2024-01-01T01:01:01.001Z");
					if (updatedAt < watermarkDate) {
						// Campaign is older than the watermark date, skip it
						includeCampaign = false;
						console.log(
							`Skipping campaign ${campaignIdentifier} due to updatedAt before watermark date`
						);
					}
				} else {
					// No hubspotCampaignDetails retrieved, skip this campaign
					includeCampaign = false;
					console.log(
						`Skipping campaign ${campaignIdentifier} due to missing hubspotCampaign details`
					);
				}
			} else {
				// No campaign associated with content, skip this campaign
				includeCampaign = false;
				console.log(
					`Skipping campaign ${campaignIdentifier} due to missing content or campaign`
				);
			}

			if (!includeCampaign) {
				continue; // Skip this campaign
			}

			// Process events to determine engagement and recipients
			const recipientEventsMap = processEmailEvents(
				campaignIdentifier,
				allEvents
			);

			// Prepare the analysis object
			const analysis = {
				id: campaignIdentifier,
				campaign: campaignDetails,
				content: contentDetails,
				recipientEventsMap: recipientEventsMap,
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
	getHubSpotCampaign,
};