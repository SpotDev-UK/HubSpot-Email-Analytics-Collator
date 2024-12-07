# HubSpot Email Analytics Collator

HubSpot's API does not aggregate data for Marketing Emails and their performance metrics in one place. This makes integrating the data into third-party platforms or analytics tools challenging. This script:

1. Fetches all Marketing Email Events from your HubSpot portal.
2. Retrieves and records Email Campaign data associated with those events.
3. Retrieves overall performance data for the associated Email Content.
4. Retrieves the body (content) of the Marketing Email.
5. Collates all this information into a set of JSON files for easy consumption and further analytics.

## New Functionality

In addition to collecting analytics data, this updated version simulates the creation of "Email Send" records intended for Salesforce. Rather than sending these records to Salesforce, the script now writes out a JSON file for each send into the `salesforce_sends` folder. Each file represents the payload that would have been sent to Salesforce, including a `HubSpot_Email_Send_ID__c` field derived directly from the HubSpot event ID.

### Example of a Single Send Payload

Below is an example of a JSON file that you might find in the `salesforce_sends` folder. This shows a single send to one recipient, including the unique `HubSpot_Email_Send_ID__c`:

```json
{
  "Contact__c": "003_simulatedContactId",
  "Lead__c": null,
  "Email_Address__c": "bob@bobness.co.uk",
  "HubSpot_Email_Campaign__c": 882197134314,
  "HubSpot_Email_Send_ID__c": "0ab6b318-ec57-3284-b23f-asdfj123rfjsaf",
  "Total_Clicks__c": 0,
  "Total_Opened__c": 1,
  "Total_Replies__c": 0,
  "Unsubscribed__c": false
}
```
This record mirrors what would have been sent to Salesforce, allowing you to review and verify the structure and content before integrating with your Salesforce org.

## Output Files

### Campaign and Engagement Data (`hubspot_analytics` folder):
Each JSON file corresponds to one email campaign and includes arrays of:
- `opens`
- `clicks`
- `unsubscribes`

There is also an `email_analytics_summary.json` file that provides a high-level overview of all processed campaigns.

### Simulated Salesforce Payloads (`salesforce_sends` folder):
One JSON file per email send. Each file includes the data mapped to fields that would be sent to Salesforce, including the `HubSpot_Email_Send_ID__c` unique to that event.

## Setup Instructions

1. Add your HubSpot Private App token to the `variables.json` file.
2. To run a limited test, set the `testMode` variable to `true` in `collateEmails.js` to restrict the number of fetched events to 1,000.
3. Run `node collateEmails.js`.
4. Review the resulting files in:
   - `hubspot_analytics` for campaign-level analytics  
   - `salesforce_sends` for simulated Salesforce payloads
5. Once you confirm everything looks correct, revert `testMode` to `false` and run the script again for a full dataset.

By following these steps, you will gain a comprehensive view of your Marketing Email performance data and have detailed records ready to be integrated into Salesforce or other systems as needed.
