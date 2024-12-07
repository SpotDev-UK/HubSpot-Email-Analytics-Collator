# HubSpot Email Analytics Collator
HubSpot's API doesn't do a good job of brining all information for Marketing Emails and performance into one place. This makes integrating the data into third-party storage for analytics purposes demanding. 
This script will: 
1. Look through all Marketing Email Events in your HubSpot portal
2. Look at the Email Campaigns associated with those events and capture data about the Email Campaign
3. Look up overall performance of the Email Content assoicated with the Email Campaign
4. Look up the body of the Email Content
5. Collate this information into a single JSON file.

## Output files
JSON files will go into the `email_analytics` folder. You can see the users who interacted with your email represented by their email addresses. You can see this engagement data in three arrays:
* opens
* clicks
* unsubscribes.

It wouldn't be demanding to expand that to other email events. 

## Set up instructions
1. Add your HubSpot Private App token to the `variables.json` file
2. Run a test by setting the `testMode` variable to `true` in the `collateEmails.js` file (this limits Email Events to 1,000 records - otherwise you'll find yourself waiting a long time to see if it works)
3. Run `collateEmails.js`
4. Review the data in the `hubspot_analytics` folder
5. Assuming you don't need to make any adjustments, change the `testMode` variable back to `true` and run the process again. 
