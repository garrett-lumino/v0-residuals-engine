/**
 * Airtable Script: Populate lumino_mid in Softr Merchant Residuals
 * 
 * Run this in Airtable's Scripting app
 * 
 * This script:
 * 1. Builds a lookup map from Softr Merchants (dba_name -> lumino_mid)
 * 2. Gets all Softr Merchant Residuals records
 * 3. Matches by dba_name and updates lumino_mid
 */

// ============ STEP 1: Build lookup from Softr Merchants ============
console.log("Step 1: Building lumino_mid lookup from Softr Merchants...");

const merchantsTable = base.getTable("Softr Merchants");
const merchantsQuery = await merchantsTable.selectRecordsAsync({
    fields: ["dba_name", "lumino_mid"]
});

// Build lookup map: normalized DBA name -> lumino_mid (as linked record ID)
const luminoMidLookup = {};

for (const record of merchantsQuery.records) {
    // lumino_mid is a linked record field - get the record ID
    const linkedMid = record.getCellValue("lumino_mid");

    if (!linkedMid || linkedMid.length === 0) {
        continue; // Skip if no lumino_mid
    }

    // dba_name is a linked record field - get the name from it
    const linkedDba = record.getCellValue("dba_name");

    if (linkedDba && linkedDba.length > 0) {
        const dbaName = linkedDba[0].name;
        const normalizedName = dbaName.toUpperCase().trim();
        // Store the linked record ID for the lumino_mid
        luminoMidLookup[normalizedName] = linkedMid[0].id;
    }
}

console.log(`Found ${Object.keys(luminoMidLookup).length} merchants with lumino_mid`);

// DEBUG: Show sample entries from lookup
const lookupKeys = Object.keys(luminoMidLookup).slice(0, 10);
console.log("\nSample DBA names from Softr Merchants lookup:");
lookupKeys.forEach(key => console.log(`  "${key}"`));

// ============ STEP 2: Get all Softr Merchant Residuals ============
console.log("\nStep 2: Fetching Softr Merchant Residuals...");

const residualsTable = base.getTable("Softr Merchant Residuals");
const residualsQuery = await residualsTable.selectRecordsAsync({
    fields: ["dba_name", "lumino_mid"]
});

console.log(`Found ${residualsQuery.records.length} residual records`);

// DEBUG: Show sample dba_names from residuals
const sampleResiduals = residualsQuery.records.slice(0, 10);
console.log("\nSample DBA names from Softr Merchant Residuals:");
sampleResiduals.forEach(r => {
    const name = r.getCellValueAsString("dba_name");
    const normalized = name.toUpperCase().trim();
    const hasMatch = luminoMidLookup[normalized] ? "MATCH" : "NO MATCH";
    console.log(`  "${normalized}" -> ${hasMatch}`);
});

// ============ STEP 3: Match and collect updates ============
console.log("\nStep 3: Matching residuals to lumino_mid...");

const updates = [];
const noMatch = [];
const alreadyHasMid = [];

for (const record of residualsQuery.records) {
    const existingMid = record.getCellValueAsString("lumino_mid");
    
    // Skip if already has a lumino_mid
    if (existingMid && existingMid.trim() !== "") {
        alreadyHasMid.push(record.id);
        continue;
    }
    
    // Get dba_name (text field in residuals table)
    const dbaName = record.getCellValueAsString("dba_name");
    
    if (dbaName && dbaName.trim() !== "") {
        const normalizedName = dbaName.toUpperCase().trim();
        
        // Look up in merchants
        const luminoMid = luminoMidLookup[normalizedName];
        
        if (luminoMid) {
            // lumino_mid is a linked record field - pass as array of {id}
            updates.push({
                id: record.id,
                fields: { "lumino_mid": [{ id: luminoMid }] }
            });
        } else {
            noMatch.push(dbaName);
        }
    }
}

console.log(`Matches found: ${updates.length}`);
console.log(`Already has lumino_mid: ${alreadyHasMid.length}`);
console.log(`No match found: ${noMatch.length}`);

// ============ STEP 4: Batch update ============
console.log("\nStep 4: Updating records...");

// Airtable limits batch updates to 50 records at a time
let successCount = 0;
const batchSize = 50;

for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);
    await residualsTable.updateRecordsAsync(batch);
    successCount += batch.length;
    console.log(`Updated ${successCount} / ${updates.length} records...`);
}

// ============ SUMMARY ============
console.log("\n========== COMPLETE ==========");
console.log(`Total residual records: ${residualsQuery.records.length}`);
console.log(`Updated with lumino_mid: ${successCount}`);
console.log(`Already had lumino_mid: ${alreadyHasMid.length}`);
console.log(`No match in merchants: ${noMatch.length}`);



