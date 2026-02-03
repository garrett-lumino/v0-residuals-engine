/**
 * Populate Softr Partners Table with Partner Names
 * 
 * This script reads all partners from the Partners table and creates
 * corresponding records in the Softr Partners table with linked references.
 * 
 * Environment Variables Required:
 * - AIRTABLE_API_KEY: Your Airtable Personal Access Token
 */

import Airtable from 'airtable';

// Configuration
const BASE_ID = 'appRygdwVIEtbUI1C';
const PARTNERS_TABLE_ID = 'tbl4Ea0fxLzlGpuUd';
const SOFTR_PARTNERS_TABLE_ID = 'tblA0OXVAySduxCar';

// Field Names (Airtable SDK uses field names, not IDs)
const PARTNER_NAME_FIELD = 'Partner Name';  // Partner Name in Partners table
const SOFTR_PARTNER_NAME_LINK = 'partner_name';  // partner_name linked field in Softr Partners

interface Partner {
  id: string;
  name: string;
}

async function main() {
  // Initialize Airtable
  const apiKey = process.env.AIRTABLE_API_KEY;
  if (!apiKey) {
    console.error('Error: AIRTABLE_API_KEY environment variable is required');
    process.exit(1);
  }

  Airtable.configure({ apiKey });
  const base = Airtable.base(BASE_ID);

  console.log('=== Softr Partners Population Script ===\n');

  // Step 1: Fetch all partners from Partners table
  console.log('Step 1: Fetching partners from Partners table...');
  const partners: Partner[] = [];

  await base(PARTNERS_TABLE_ID)
    .select({
      fields: [PARTNER_NAME_FIELD],
      maxRecords: 1000,
    })
    .eachPage((records, fetchNextPage) => {
      for (const record of records) {
        const name = record.get(PARTNER_NAME_FIELD) as string;
        if (name) {
          partners.push({
            id: record.id,
            name: name.trim(),
          });
        }
      }
      fetchNextPage();
    });

  console.log(`Found ${partners.length} partners\n`);

  // Step 2: Check existing Softr Partners to avoid duplicates
  console.log('Step 2: Checking existing Softr Partners...');
  const existingLinks = new Set<string>();

  await base(SOFTR_PARTNERS_TABLE_ID)
    .select({
      fields: [SOFTR_PARTNER_NAME_LINK],
      maxRecords: 1000,
    })
    .eachPage((records, fetchNextPage) => {
      for (const record of records) {
        const linkedPartners = record.get(SOFTR_PARTNER_NAME_LINK) as string[] | undefined;
        if (linkedPartners) {
          linkedPartners.forEach((id) => existingLinks.add(id));
        }
      }
      fetchNextPage();
    });

  console.log(`Found ${existingLinks.size} existing linked partners\n`);

  // Step 3: Filter partners that don't already exist in Softr Partners
  const newPartners = partners.filter((p) => !existingLinks.has(p.id));
  console.log(`Partners to add: ${newPartners.length}\n`);

  if (newPartners.length === 0) {
    console.log('No new partners to add. All partners are already linked.');
    return;
  }

  // Step 4: Create records in Softr Partners table
  console.log('Step 4: Creating Softr Partners records...\n');

  // Airtable API allows max 10 records per request
  const batchSize = 10;
  let created = 0;
  let errors = 0;

  for (let i = 0; i < newPartners.length; i += batchSize) {
    const batch = newPartners.slice(i, i + batchSize);

    const recordsToCreate = batch.map((partner) => ({
      fields: {
        [SOFTR_PARTNER_NAME_LINK]: [partner.id],  // Link to Partners table record
      },
    }));

    try {
      await base(SOFTR_PARTNERS_TABLE_ID).create(recordsToCreate);
      created += batch.length;
      console.log(`Created ${created}/${newPartners.length} records...`);
    } catch (error) {
      errors += batch.length;
      console.error(`Error creating batch starting at index ${i}:`, error);
    }

    // Rate limiting - Airtable allows 5 requests per second
    if (i + batchSize < newPartners.length) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Total partners found: ${partners.length}`);
  console.log(`Already existed: ${existingLinks.size}`);
  console.log(`Successfully created: ${created}`);
  console.log(`Errors: ${errors}`);
}

main().catch(console.error);

