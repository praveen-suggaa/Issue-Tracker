import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

(async () => {
  const { graphql } = await import('@octokit/graphql');

  // Configuration
  const githubToken = process.env.PAT;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;

  if (!githubToken || !supabaseUrl || !supabaseKey) {
    console.error("Missing environment variables. Ensure PAT, SUPABASE_URL, and SUPABASE_KEY are set.");
    process.exit(1);
  }

  // Initialize Supabase client
  const supabase = createClient(supabaseUrl, supabaseKey);

  const projectNumbers = [12];

  // GitHub GraphQL query function with pagination
  async function fetchAllProjectItems(org, projectNumber) {
    const graphqlWithAuth = graphql.defaults({
      headers: {
        authorization: `token ${githubToken}`,
      },
    });

    const query = `
      query ($org: String!, $projectNumber: Int!, $cursor: String) {
        organization(login: $org) {
          projectV2(number: $projectNumber) {
            items(first: 100, after: $cursor) {
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
                    createdAt
                    assignees(first: 10) {
                      nodes {
                        login
                      }
                    }
                  }
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      }
    `;

    let allNodes = [];
    let hasNextPage = true;
    let cursor = null;

    while (hasNextPage) {
      try {
        const result = await graphqlWithAuth({
          query,
          org,
          projectNumber,
          cursor,
        });

        const { nodes, pageInfo } = result.organization.projectV2.items;
        allNodes = allNodes.concat(nodes);
        hasNextPage = pageInfo.hasNextPage;
        cursor = pageInfo.endCursor;
      } catch (error) {
        console.error("Error fetching project items:", error);
        throw error;
      }
    }

    return allNodes.map((item) => {
      if (item.content?.createdAt) {
        const utcDate = new Date(item.content.createdAt);
        const istDate = new Date(utcDate.getTime() + 330 * 60 * 1000); // Add 330 minutes for IST
        item.content.createdAtIST = istDate.toISOString(); // Add createdAtIST field
      }
      return item;
    });
  }

  async function syncProjectItemsToSupabase(items) {
    if (!Array.isArray(items) || items.length === 0) {
      console.error("No items to sync or invalid data structure");
      return;
    }

    for (let item of items) {
      const issueNumber = item.content ? item.content.number : "N/A";
      const issueUrl = item.content ? item.content.url : "N/A";
      const createdAtIST = item.content?.createdAtIST || "Unknown";

      const issueTitle = item.fieldValues.nodes.find((field) => field.field?.name === "Title")?.text || "No Title";
      const priority = item.fieldValues.nodes.find((field) => field.field?.name === "Priority")?.name || "No Priority";
      const issueType = item.fieldValues.nodes.find((field) => field.field?.name === "Issue Type")?.name || "No Issue Type";
      const createdBy = item.fieldValues.nodes.find((field) => field.field?.name === "Created by")?.text || "Unknown";
      const appName = item.fieldValues.nodes.find((field) => field.field?.name === "App Name")?.name || "N/A";
      const buildType = item.fieldValues.nodes.find((field) => field.field?.name === "Build Type")?.name || "N/A";
      const buildVersion = item.fieldValues.nodes.find((field) => field.field?.name === "Build Version")?.text || "N/A";
      const deviceType = item.fieldValues.nodes.find((field) => field.field?.name === "Device Type")?.name || "N/A";
      const status = item.fieldValues.nodes.find((field) => field.field?.name === "Status")?.name || "No Status";

      const assignees = item.content.assignees ? item.content.assignees.nodes.map((assignee) => assignee.login) : ["Unassigned"];

      const currentTime = new Date();
      const istTime = new Date(currentTime.getTime() + 330 * 60 * 1000);
      const adjustedTime = new Date(istTime.getTime() - (10 * 60 * 1000));

      const { data: existingIssue, error: fetchError } = await supabase
        .from('issue_tracker')
        .select('issue_number, start_time, end_time, updated_at, status')
        .eq('issue_number', issueNumber)
        .single();

      if (fetchError && fetchError.code !== 'PGRST116') {
        console.error('Error checking for existing issue:', fetchError.message);
        continue;
      }

      const updateData = {
        issue_title: issueTitle,
        issue_url: issueUrl,
        assignees: assignees,
        priority: priority,
        issue_type: issueType,
        created_by: createdBy,
        app_name: appName,
        build_type: buildType,
        build_version: buildVersion,
        device_type: deviceType,
        created_at: createdAtIST,
      };

      if (!existingIssue || existingIssue.status !== status) {
        updateData.status = status;
        updateData.updated_at = istTime.toISOString();
      }

      if (status === "In progress" && (!existingIssue || !existingIssue.start_time)) {
        updateData.start_time = adjustedTime;
      }

      if (status === "Done" && (!existingIssue || !existingIssue.end_time)) {
        updateData.end_time = adjustedTime;
      }

      if (existingIssue) {
        const { error } = await supabase
          .from('issue_tracker')
          .update(updateData)
          .eq('issue_number', issueNumber);

        if (error) {
          console.error('Error updating project item:', error.message);
        } else {
          console.log('Project item updated successfully.');
        }
      } else {
        updateData.updated_at = istTime.toISOString();
        updateData.issue_number = issueNumber;

        const { error } = await supabase
          .from('issue_tracker')
          .insert([updateData]);

        if (error) {
          console.error('Error syncing project item:', error.message);
        } else {
          console.log('Project item inserted successfully.');
        }
      }
    }
  }

  async function main() {
    const org = 'SuggaaVentures';

    for (const projectNumber of projectNumbers) {
      try {
        console.log(`Fetching data for project ${projectNumber}...`);
        const projectData = await fetchAllProjectItems(org, projectNumber);
        console.log(`Syncing data for project ${projectNumber}...`);
        await syncProjectItemsToSupabase(projectData);
      } catch (error) {
        console.error(`Error in processing project ${projectNumber}:`, error);
      }
    }
  }

  main();
})();
