/**
 * Airtable Script: Update processor_mid in Softr Merchants
 *
 * Run this in Airtable's Scripting app
 *
 * This script:
 * 1. Builds a lookup map from Softr Merchant Residuals (dba_name -> processor_mid)
 * 2. Gets all Softr Merchants with their linked dba_name
 * 3. Matches and updates processor_mid for each merchant
 */

// ============ STEP 1: Build lookup from Softr Merchant Residuals ============
console.log("Step 1: Building processor_mid lookup from Softr Merchant Residuals...");

const residualsTable = base.getTable("Softr Merchant Residuals");
const residualsQuery = await residualsTable.selectRecordsAsync({
    fields: ["dba_name", "processor_mid"]
});

// Build lookup map: normalized DBA name -> processor_mid
const processorMidLookup = {};
for (const record of residualsQuery.records) {
    const dbaName = record.getCellValueAsString("dba_name");
    const processorMid = record.getCellValueAsString("processor_mid");

    if (dbaName && processorMid) {
        // Normalize: uppercase and trim for matching
        const normalizedName = dbaName.toUpperCase().trim();
        processorMidLookup[normalizedName] = processorMid;
    }
}

console.log(`Found ${Object.keys(processorMidLookup).length} residuals with processor_mid`);

// ============ STEP 2: Get all Softr Merchants ============
console.log("\nStep 2: Fetching Softr Merchants...");

const merchantsTable = base.getTable("Softr Merchants");
const merchantsQuery = await merchantsTable.selectRecordsAsync({
    fields: ["dba_name", "processor_mid"]
});

console.log(`Found ${merchantsQuery.records.length} merchants`);

// ============ STEP 3: Match and collect updates ============
console.log("\nStep 3: Matching merchants to processor_mid...");

const updates = [];
const noMatch = [];
const alreadyHasMid = [];

for (const record of merchantsQuery.records) {
    const existingMid = record.getCellValueAsString("processor_mid");

    // Skip if already has a processor_mid
    if (existingMid && existingMid.trim() !== "") {
        alreadyHasMid.push(record.id);
        continue;
    }

    // Get linked dba_name (returns array of linked records)
    const linkedDba = record.getCellValue("dba_name");

    if (linkedDba && linkedDba.length > 0) {
        // The linked record's name is the DBA name from Applications HQ
        const dbaName = linkedDba[0].name;
        const normalizedName = dbaName.toUpperCase().trim();

        // Look up in residuals
        const processorMid = processorMidLookup[normalizedName];

        if (processorMid) {
            updates.push({
                id: record.id,
                fields: { "processor_mid": processorMid }
            });
        } else {
            noMatch.push(dbaName);
        }
    }
}

console.log(`Matches found: ${updates.length}`);
console.log(`Already has processor_mid: ${alreadyHasMid.length}`);
console.log(`No match found: ${noMatch.length}`);

// ============ STEP 4: Batch update ============
console.log("\nStep 4: Updating records...");

// Airtable limits batch updates to 50 records at a time
let successCount = 0;
const batchSize = 50;

for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);
    await merchantsTable.updateRecordsAsync(batch);
    successCount += batch.length;
    console.log(`Updated ${successCount} / ${updates.length} records...`);
}

// ============ SUMMARY ============
console.log("\n========== COMPLETE ==========");
console.log(`Total merchants: ${merchantsQuery.records.length}`);
console.log(`Updated with processor_mid: ${successCount}`);
console.log(`Already had processor_mid: ${alreadyHasMid.length}`);
console.log(`No match in residuals: ${noMatch.length}`);

if (noMatch.length > 0 && noMatch.length <= 20) {
    console.log("\nUnmatched DBAs:");
    noMatch.forEach(name => console.log(`  - ${name}`));
}

