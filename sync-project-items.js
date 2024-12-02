import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';


(async () => {
  const { graphql } = await import('@octokit/graphql');

  // Configuration
  const githubToken = process.env.PAT;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;

  // Initialize Supabase client
  const supabase = createClient(supabaseUrl, supabaseKey);

  // GitHub GraphQL query function
  async function fetchProjectItems(org, projectNumber) {
    const graphqlWithAuth = graphql.defaults({
      headers: {
        authorization: `token ${githubToken}`
      }
    });

    const query = `
      query ($org: String!, $projectNumber: Int!) {
        organization(login: $org) {
          projectV2(number: $projectNumber) {
            items(first: 100) {
              nodes {
                id
                fieldValues(first: 20) {
                  nodes {
                    ... on ProjectV2ItemFieldTextValue {
                      text
                      field {
                        ... on ProjectV2Field {
                          name
                        }
                      }
                    }
                    ... on ProjectV2ItemFieldSingleSelectValue {
                      name
                      field {
                        ... on ProjectV2SingleSelectField {
                          name
                        }
                      }
                    }
                    ... on ProjectV2ItemFieldDateValue {
                      date
                      field {
                        ... on ProjectV2Field {
                          name
                        }
                      }
                    }
                  }
                }
                content {
                  ... on Issue {
                    title
                    number
                    url
                    assignees(first: 10) {
                      nodes {
                        login
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    try {
      const result = await graphqlWithAuth({
        query,
        org,
        projectNumber
      });
      return result.organization.projectV2.items.nodes; // Return nodes directly
    } catch (error) {
      console.error('Error fetching project items:', error);
      throw error;
    }
  }

  async function syncProjectItemsToSupabase(items) {
    if (!Array.isArray(items) || items.length === 0) {
      console.error('No items to sync or invalid data structure');
      return; // Exit if items is not an array or is empty
    }
  
    for (let item of items) {
      const issueNumber = item.content ? item.content.number : "N/A";
      const issueUrl = item.content ? item.content.url : "N/A";
  
      // Safely access the title
      const issueTitle = item.fieldValues.nodes.find(field => field.field?.name === "Title")?.text || "No Title";
      
      // Safely access other fields
      const priority = item.fieldValues.nodes.find(field => field.field?.name === "Priority")?.name || "No Priority";
      const issueType = item.fieldValues.nodes.find(field => field.field?.name === "Issue Type")?.name || "No Issue Type";
      const createdBy = item.fieldValues.nodes.find(field => field.field?.name === "Created by")?.text || "Unknown";
      const appName = item.fieldValues.nodes.find(field => field.field?.name === "App Name")?.name || "N/A";
      const buildType = item.fieldValues.nodes.find(field => field.field?.name === "Build Type")?.name || "N/A";
      const buildVersion = item.fieldValues.nodes.find(field => field.field?.name === "Build Version")?.text || "N/A";
      const deviceType = item.fieldValues.nodes.find(field => field.field?.name === "Device Type")?.name || "N/A";
      const status = item.fieldValues.nodes.find(field => field.field?.name === "Status")?.name || "No Status";
  
      // Assignees: Map usernames of assignees
      const assignees = item.content.assignees ? item.content.assignees.nodes.map(assignee => assignee.login) : ["Unassigned"];
  
      const currentTime = new Date();
  
      // Check if the issue already exists in Supabase based on the issue_number
      const { data: existingIssue, error: fetchError } = await supabase
        .from('issue_tracker')
        .select('issue_number, start_time, end_time')
        .eq('issue_number', issueNumber)
        .single();
  
      if (fetchError && fetchError.code !== 'PGRST116') { // Ignore "not found" error code
        console.error('Error checking for existing issue:', fetchError.message);
        continue;
      }
  
      if (existingIssue) {
        // If the issue exists, prepare update data
        const updateData = {
          issue_title: issueTitle,
          issue_url: issueUrl,
          assignees: assignees,
          status: status,
          priority: priority,
          issue_type: issueType,
          created_by: createdBy,
          app_name: appName,
          build_type: buildType,
          build_version: buildVersion,
          device_type: deviceType
        };
  
        // Only add start_time if it doesn't already exist and status is "In progress"
        if (status === "In progress" && !existingIssue.start_time) {
          updateData.start_time = currentTime;
        }
  
        // Only add end_time if it doesn't already exist and status is "Done"
        if (status === "Done" && !existingIssue.end_time) {
          updateData.end_time = currentTime;
        }
  
        const { data, error } = await supabase
          .from('issue_tracker')
          .update(updateData)
          .eq('issue_number', issueNumber);
  
        if (error) {
          console.error('Error updating project item:', error.message);
        } else {
          console.log('Project item updated successfully:', data);
        }
      } else {
        // If the issue does not exist, insert a new record
        const insertData = {
          issue_title: issueTitle,
          issue_number: issueNumber,
          issue_url: issueUrl,
          assignees: assignees,
          status: status,
          priority: priority,
          issue_type: issueType,
          created_by: createdBy,
          app_name: appName,
          build_type: buildType,
          build_version: buildVersion,
          device_type: deviceType
        };
  
        // Set start_time only if status is "In progress"
        if (status === "In progress") {
          insertData.start_time = currentTime;
        }
  
        // Set end_time only if status is "Done"
        if (status === "Done") {
          insertData.end_time = currentTime;
        }
  
        const { data, error } = await supabase
          .from('issue_tracker')
          .insert([insertData]);
  
        if (error) {
          console.error('Error syncing project item:', error.message);
        } else {
          console.log('Project item inserted successfully:', data);
        }
      }
    }
  }


  // Main execution
  async function main() {
    const org = 'SuggaaVentures';
    const projectNumber = 7;

    try {
      const projectData = await fetchProjectItems(org, projectNumber);
      await syncProjectItemsToSupabase(projectData); // Passing only the nodes array to the sync function
    } catch (error) {
      console.error('Error in main execution:', error);
      process.exit(1);
    }
  }

  main();
})();
