/**
 * Airtable Script: Populate Softr Partners Table
 *
 * Run this in Airtable's Scripting app
 *
 * This script:
 * 1. Gets all partners from the Partners table
 * 2. Checks existing records in Softr Partners to avoid duplicates
 * 3. Creates new records in Softr Partners with links to Partners
 */

// ============ STEP 1: Get all partners from Partners table ============
console.log("Step 1: Fetching partners from Partners table...");

const partnersTable = base.getTable("Partners");
const partnersQuery = await partnersTable.selectRecordsAsync({
    fields: ["Partner Name"]
});

const partners = [];
for (const record of partnersQuery.records) {
    const name = record.getCellValueAsString("Partner Name");
    if (name && name.trim() !== "") {
        partners.push({
            id: record.id,
            name: name.trim()
        });
    }
}

console.log(`Found ${partners.length} partners with names`);

// ============ STEP 2: Check existing Softr Partners ============
console.log("\nStep 2: Checking existing Softr Partners...");

const softrPartnersTable = base.getTable("Softr Partners");
const softrPartnersQuery = await softrPartnersTable.selectRecordsAsync({
    fields: ["partner_name"]
});

// Build set of already-linked partner record IDs
const existingPartnerIds = new Set();
for (const record of softrPartnersQuery.records) {
    const linkedPartner = record.getCellValue("partner_name");
    if (linkedPartner && linkedPartner.length > 0) {
        existingPartnerIds.add(linkedPartner[0].id);
    }
}

console.log(`Found ${existingPartnerIds.size} existing linked partners`);
console.log(`Existing Softr Partners records: ${softrPartnersQuery.records.length}`);

// ============ STEP 3: Filter partners that need to be added ============
console.log("\nStep 3: Filtering partners to add...");

const partnersToAdd = partners.filter(p => !existingPartnerIds.has(p.id));
console.log(`Partners to add: ${partnersToAdd.length}`);

if (partnersToAdd.length === 0) {
    console.log("\n✓ All partners are already linked. Nothing to do.");
} else {
    // ============ STEP 4: Create records in Softr Partners ============
    console.log("\nStep 4: Creating Softr Partners records...");

    // Airtable limits batch creates to 50 records at a time
    const batchSize = 50;
    let createdCount = 0;

    for (let i = 0; i < partnersToAdd.length; i += batchSize) {
        const batch = partnersToAdd.slice(i, i + batchSize);

        const recordsToCreate = batch.map(partner => ({
            fields: {
                "partner_name": [{ id: partner.id }]  // Link to Partners table record
            }
        }));

        await softrPartnersTable.createRecordsAsync(recordsToCreate);
        createdCount += batch.length;
        console.log(`Created ${createdCount} / ${partnersToAdd.length} records...`);
    }

    // ============ SUMMARY ============
    console.log("\n========== COMPLETE ==========");
    console.log(`Total partners in Partners table: ${partners.length}`);
    console.log(`Already existed in Softr Partners: ${existingPartnerIds.size}`);
    console.log(`Successfully created: ${createdCount}`);
}

