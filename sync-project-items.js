import { createClient } from '@supabase/supabase-js';
import { graphql } from '@octokit/graphql';

// Configuration
const GITHUB_TOKEN = process.env.PAT;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// GitHub GraphQL API query
const QUERY = `
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

// Fetch GitHub project items
async function fetchProjectItems(org, projectNumber) {
  const graphqlWithAuth = graphql.defaults({
    headers: {
      authorization: `Bearer ${GITHUB_TOKEN}`,
    },
  });

  try {
    const result = await graphqlWithAuth({
      query: QUERY,
      org,
      projectNumber,
    });
    return result.data.organization.projectV2.items.nodes;
  } catch (error) {
    console.error('Error fetching project items:', error);
    throw error;
  }
}

// Sync project items to Supabase
async function syncProjectItems(items) {
  for (const item of items) {
    const issueNumber = item.content?.number || 'N/A';
    const issueKey = `issue_${issueNumber}`;

    // Default field mapping
    const fieldMap = {
      Status: 'No Status',
      Priority: 'No Priority',
      'Issue Type': 'No Issue Type',
      'Created By': 'Unknown',
      'App Name': 'N/A',
      'Build Type': 'N/A',
      'Build Version': 'N/A',
      'Device Type': 'N/A',
      Timeline: 'N/A',
    };

    // Process field values
    if (item.fieldValues?.nodes) {
      for (const fieldValue of item.fieldValues.nodes) {
        if (fieldValue.field?.name) {
          const fieldName = fieldValue.field.name;
          const value = fieldValue.text || fieldValue.name || fieldValue.date || 'No Value';

          Object.keys(fieldMap).forEach((key) => {
            if (key.toLowerCase() === fieldName.toLowerCase()) {
              fieldMap[key] = value;
            }
          });
        }
      }
    }

    // Process assignees
    const assignees = item.content?.assignees?.nodes.map((a) => a.login).join(', ') || 'Unassigned';

    // Prepare data for Supabase
    const projectItemData = {
      issue_title: item.content?.title || 'No Title',
      issue_number: issueNumber,
      issue_url: item.content?.url || 'N/A',
      assignees,
      status: fieldMap.Status,
      priority: fieldMap.Priority,
      issue_type: fieldMap['Issue Type'],
      created_by: fieldMap['Created By'],
      app_name: fieldMap['App Name'],
      build_type: fieldMap['Build Type'],
      build_version: fieldMap['Build Version'],
      device_type: fieldMap['Device Type'],
      timeline: fieldMap.Timeline,
    };

    try {
      const { error } = await supabase
        .from('project_items')
        .upsert(projectItemData, { onConflict: 'issue_number', returning: 'minimal' });

      if (error) {
        console.error(`Error syncing issue ${issueNumber}:`, error.message);
      } else {
        console.log(`Synced issue ${issueNumber}: ${projectItemData.issue_title}`);
      }
    } catch (error) {
      console.error(`Unexpected error syncing issue ${issueNumber}:`, error);
    }
  }
}

// Main function
async function main() {
  const ORG = 'SuggaaVentures';
  const PROJECT_NUMBER = 7;

  try {
    const items = await fetchProjectItems(ORG, PROJECT_NUMBER);
    if (!items || items.length === 0) {
      console.log('No items found in the project.');
      return;
    }
    await syncProjectItems(items);
  } catch (error) {
    console.error('Error in main execution:', error);
    process.exit(1);
  }
}

main();
