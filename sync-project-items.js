// Use dynamic import to load the @octokit/graphql module (ESM)
const { createClient } = require('@supabase/supabase-js');

(async () => {
  const { graphql } = await import('@octokit/graphql');

  // Configuration
  const githubToken = process.env.GITHUB_TOKEN;
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
      return result;
    } catch (error) {
      console.error('Error fetching project items:', error);
      throw error;
    }
  }

  // Sync project items to Supabase
  async function syncProjectItemsToSupabase(data) {
    const items = data.organization.projectV2.items.nodes;

    for (const item of items) {
      // Prepare project item data
      const projectItemData = {
        issue_title: item.content?.title || 'No Title',
        issue_number: item.content?.number,
        issue_url: item.content?.url,
        
        // Process assignees
        assignees: item.content?.assignees?.nodes
          ?.map(assignee => assignee.login)
          .join(', ') || 'Unassigned',
        
        // Default field map
        status: 'No Status',
        priority: 'No Priority',
        issue_type: 'No Issue Type',
        created_by: 'Unknown',
        app_name: 'N/A',
        build_type: 'N/A',
        build_version: 'N/A',
        device_type: 'N/A',
        timeline: 'N/A'
      };

      // Process field values
      if (item.fieldValues?.nodes) {
        for (const fieldValue of item.fieldValues.nodes) {
          if (fieldValue.field?.name) {
            const fieldName = fieldValue.field.name.toLowerCase();
            const value = fieldValue.text || fieldValue.name || fieldValue.date || 'No Value';

            // Map field names to our data structure
            const fieldMapping = {
              'status': 'status',
              'priority': 'priority',
              'issue type': 'issue_type',
              'created by': 'created_by',
              'app name': 'app_name',
              'build type': 'build_type',
              'build version': 'build_version',
              'device type': 'device_type',
              'timeline': 'timeline'
            };

            // Update corresponding field if found
            for (const [key, mappedKey] of Object.entries(fieldMapping)) {
              if (key === fieldName) {
                projectItemData[mappedKey] = value;
              }
            }
          }
        }
      }

      // Upsert to Supabase
      try {
        const { data, error } = await supabase
          .from('project_items')
          .upsert(projectItemData, { 
            onConflict: 'issue_number',
            returning: 'minimal'
          });

        if (error) throw error;
        console.log(`Synced project item: ${projectItemData.issue_title}`);
      } catch (error) {
        console.error(`Error syncing project item: ${error.message}`);
      }
    }
  }

  // Main execution
  async function main() {
    const org = 'SuggaaVentures';
    const projectNumber = 7;

    try {
      const projectData = await fetchProjectItems(org, projectNumber);
      await syncProjectItemsToSupabase(projectData);
    } catch (error) {
      console.error('Error in main execution:', error);
      process.exit(1);
    }
  }

  main();
})();
