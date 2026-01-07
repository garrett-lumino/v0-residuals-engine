# Code Change Log


## 2026-01-07 (Post-Payout Adjustments Table UI Improvements)

### Files Changed
- `app/tools/adjustments/page.tsx`

### Summary
Enhanced the deals table in the "Create" tab with better context for deal identification: added Payout Date column and replaced participant count with actual names.

### Details
**Changes Made:**

1. **Added `effective_date` to Deal interface** (line 68)
   - Added optional `effective_date?: string | null` field to support payout date display

2. **Added Payout Date Column** (lines 1640-1648, 1716-1725)
   - Changed grid from 6 columns to 7 columns (`grid-cols-7`)
   - New column positioned between MID and Payout Type
   - Formatted using `toLocaleDateString` with "short" month format (e.g., "Jan 7, 2026")
   - Shows "-" when no effective_date is set

3. **Replaced Participant Count with Names** (lines 1731-1748)
   - Changed from showing "3 participants" to showing actual names like "John Doe, Jane Smith, Company"
   - Only shows active participants (those with `split_pct > 0`)
   - Extracts names from `partner_name` or `name` fields (handles legacy data)
   - Falls back to "Unknown" when no name is available

4. **Implemented Text Overflow Handling**
   - Added `truncate` class to participant names column for ellipsis on overflow
   - Added `title` attribute with full participant list for hover tooltip
   - Used `text-xs` for smaller text size in constrained columns
   - Added `min-w-0` and `flex-shrink-0` classes to prevent layout issues

5. **Responsive Design Improvements**
   - Changed grid gap from `gap-4` to `gap-2` for tighter spacing with 7 columns
   - Added `truncate` class to Deal ID, Merchant, and MID columns
   - Compact button padding with `px-2` for Actions column
   - All columns now handle viewport collapse gracefully

**Technical Notes:**
- Participant names are extracted at render time using an IIFE (Immediately Invoked Function Expression)
- The same participant name list is used for both display and tooltip to ensure consistency
- Date formatting follows existing codebase patterns from DealsManagement.tsx

---

## 2026-01-07 (Fix Adjustment History Dollar Amount Display)

### Files Changed
- `app/tools/adjustments/page.tsx`

### Summary
Fixed adjustment history showing $1.00 instead of correct dollar amounts by dynamically calculating values from net_residual.

### Details
**Problem:** The adjustment history was displaying $1.00 for all adjustments because the stored `adjustment_amount` was the raw percentage difference (e.g., `1` for a 1% change) rather than the actual dollar amount.

**Solution:**
1. Added `net_residual` field to HistoryItem interface and store it when saving adjustments
2. Store `mid` and `net_residual` in adjustment records for future reference
3. Created `calculateAdjustmentDollarAmount()` helper function that:
   - First tries to use stored `net_residual * percentage_change`
   - Falls back to stored `adjustment_amount` if it looks like a dollar value
   - Returns stored amount as fallback
4. Updated both history display locations (Create tab and History tab) to use the new calculation function

**Benefit:** Existing adjustment records will still work (fallback logic), and new adjustments will store the net_residual for accurate calculations.

---

## 2026-01-07 (Fix Net Residual Display in Adjustment Dialog)

### Files Changed
- `app/api/residuals/payouts/route.ts`

### Summary
Fixed incorrect net residual display by adding missing MID filter to payouts API.

### Details
**Problem:** The adjustment dialog was showing $1.00 for all payout differences because the `/api/residuals/payouts` endpoint didn't support filtering by MID. When we called `?format=raw&mid=...`, it returned ALL payouts and we took the first one's `net_residual` (from a different deal).

**Solution:** Added `mid` parameter support to the payouts API:
- Extract `mid` from query params
- Apply `.eq("mid", mid)` filter to the Supabase query when provided

Now the dialog correctly fetches and displays the net residual for the specific deal being adjusted.

---

## 2026-01-07 (Add Third Column for Payout Difference)

### Files Changed
- `app/tools/adjustments/page.tsx`

### Summary
Added a third column "Difference" to the per-participant payout metrics showing the dollar difference between old and new splits.

### Details
- Changed grid from `grid-cols-2` to `grid-cols-3`
- Added `payoutDifference` calculation: `newPayout - oldPayout`
- Color-coded: green for positive (additional), red for negative (clawback), muted for zero
- Displays with `+` prefix for positive values

---

## 2026-01-07 (Improved Adjustment Dialog with Two-Column Layout)

### Files Changed
- `app/tools/adjustments/page.tsx`

### Summary
Replaced the adjustment dialog with an improved two-column layout that shows deal information and per-participant payout metrics.

### Details
**New Dialog Features:**
1. **Two-Column Summary Section:**
   - Left column: Merchant name, partners list, net residual, deal ID, payout type, created/updated dates
   - Right column: Per-participant payout metrics showing previous and new split amounts in dollars

2. **Net Residual Integration:**
   - Added `dealNetResidual` state variable
   - `openAdjustmentDialog` now fetches net residual from `/api/residuals/payouts` endpoint
   - Displays actual dollar amounts for each participant's split

3. **Improved Participant Table:**
   - Converted from card-based layout to a proper table with columns
   - Columns: Partner Name, Role, Old Split %, New Split %, Adjustment %, Actions
   - Total split validation displayed at bottom right

4. **Interface Updates:**
   - Added `entity_id` and `new_data` to `HistoryItem` interface for expanded history support
   - Added `created_at` and `updated_at` to `Deal` interface
   - Added `useUser` from Clerk for tracking who creates adjustments

5. **Wider Dialog:**
   - Changed from `max-w-lg` to `sm:max-w-5xl` for better content display
   - Added proper overflow handling with `max-h-[90vh]` and scrollable content area

---

## 2026-01-07 (Pending Badge Loads Immediately on Page Mount)

### Files Changed
- `app/tools/adjustments/page.tsx`

### Summary
Updated pending count badge to use summary data as fallback so it displays immediately on page load.

### Details
**Problem:** Pending tab badge only showed count after clicking the tab (when history loads)

**Solution:** Updated `pendingCount` to be a `useMemo` that:
1. Returns `pendingAdjustmentGroups.length` if history is loaded
2. Falls back to summing `adjustmentSummary[*].pending` counts (loaded on page mount)

This follows the same pattern already used for deal adjustment badges.

---

## 2026-01-07 (Add Pending Adjustments Tab with Confirm/Reject Workflow)

### Files Changed
- `app/api/adjustments/confirm/route.ts` (NEW)
- `app/api/adjustments/reject/route.ts` (NEW)
- `app/tools/adjustments/page.tsx`

### Summary
Added a dedicated "Pending" tab to the Adjustments page with full confirm/reject workflow for pending split adjustments.

### Details
**New API Endpoints:**
1. `POST /api/adjustments/confirm` - Confirms pending adjustments by updating status to "confirmed"
2. `POST /api/adjustments/reject` - Rejects pending adjustments by marking them as undone with optional reason

**New UI Features:**
1. **Pending Tab** - New tab between "Create Adjustment" and "Merge Participants"
   - Shows badge with count of pending adjustments
   - Displays table of all pending adjustment groups
   - Search functionality to filter pending adjustments

2. **Individual Actions** - Each pending adjustment row has:
   - Confirm button (green) - Opens confirmation dialog
   - Edit button - Opens adjustment dialog for modifications
   - Reject button (red) - Opens rejection dialog with optional reason

3. **Bulk Actions** - When items are selected:
   - Checkbox column for multi-select
   - "Select All" checkbox in header
   - Bulk Confirm button - Confirms all selected at once
   - Bulk Reject button - Rejects all selected with shared reason

4. **Confirmation Dialogs** - AlertDialog components for:
   - Single confirm (shows adjustment details)
   - Single reject (includes reason textarea)
   - Bulk confirm (shows count)
   - Bulk reject (includes reason textarea)

**State Management:**
- Added state for pending search, selection, dialog visibility, and loading states
- Computed `pendingAdjustmentGroups` filters from existing history data
- Clears selection when switching away from Pending tab

---

## 2026-01-07 (Fix Badge Layout and Count Mismatch)

### Files Changed
- `app/api/adjustments/summary/route.ts`
- `app/tools/adjustments/page.tsx`

### Summary
Fixed two issues: chevron arrows shrinking due to badge flex layout, and adjustment count mismatch between summary and history.

### Details
**Issue 1: Arrow size inconsistency**
- Problem: Chevron arrows next to deals with pending adjustments appeared smaller
- Cause: Flex layout allowed chevron to shrink when badge with icons took more space
- Fix: Added `flex-shrink-0` class to ChevronDown and ChevronRight icons

**Issue 2: Count mismatch (showed 10, history had 6)**
- Problem: Summary endpoint counted individual records, but UI groups by timestamp
- Example: 2 participants adjusted at same time = 2 records but 1 adjustment group
- Fix: Updated summary endpoint to group by `timestamp (minute) + status`
- Now uses a Set to count unique batch keys, matching the frontend grouping logic
- Properly counts "adjustment batches" not individual participant records

---

## 2026-01-07 (Preload Adjustment Counts for Badges on Page Load)

### Files Changed
- `app/api/adjustments/summary/route.ts` (NEW)
- `app/tools/adjustments/page.tsx`

### Summary
Added lightweight summary endpoint to load adjustment counts on page load so badges display immediately without requiring user interaction.

### Details
**Problem Solved:**
- Adjustment count badges only appeared after clicking to expand a deal row
- Refreshing the page caused badges to disappear until user interaction

**Solution:**
1. Created new API endpoint `GET /api/adjustments/summary` that returns counts per deal:
   ```json
   { "deal_123": { "total": 6, "pending": 1 }, "deal_456": { "total": 2, "pending": 0 } }
   ```
2. This endpoint only fetches `entity_id` and `new_data` fields (minimal payload)
3. Groups and counts adjustments server-side, returning only the counts
4. Page loads this summary on mount alongside deal data
5. Badges now use summary data as fallback when full history isn't loaded

**Performance:**
- Single lightweight query with GROUP BY logic
- Returns minimal payload (just counts, not full records)
- Scales well as adjustment history grows

---

## 2026-01-07 (Compact Badge with Icon Indicators)

### Files Changed
- `app/tools/adjustments/page.tsx`

### Summary
Made the adjustment count badge more compact by using icon indicators instead of text labels.

### Details
**Problem Solved:**
- The badge showing "6 adjustments (10 changes) · 1 pending" was too long and overlapping the merchant name column

**Solution:**
- Replaced verbose text with compact icon-based format: `📝 6 · ⏳ 1`
- History icon + count for total adjustments
- Clock icon + count for pending (only shown when there are pending adjustments)
- Full details available on hover via tooltip

**Before:** `6 adjustments (10 changes) · 1 pending`
**After:** `📝 6 · ⏳ 1` (with tooltip showing full details)

---

## 2026-01-07 (Fix Adjustment Grouping - Same Batch Participants Now Grouped Together)

### Files Changed
- `app/tools/adjustments/page.tsx`

### Summary
Fixed adjustment grouping logic so that participants from the same adjustment batch are now correctly grouped together as a single item, instead of appearing as separate items.

### Details
**Problem Solved:**
- Adjustments with multiple participants (e.g., Andrew Richard's clawback + Lumino's additional payout from the same action) were appearing as separate list items
- This was confusing because they were part of the same adjustment action

**Root Cause:**
- The grouping key included the `note` field: `timestamp + note + status`
- When users don't provide a note, it falls back to the `description` field which is participant-specific (e.g., "Adjusted Andrew Richard's split from 2% to 1%")
- This caused each participant to have a unique key, breaking the grouping

**Fix Applied:**
- Changed `getDealAdjustmentGroups` grouping key from `timestamp_note_status` to just `timestamp_status`
- Now groups by: `adj_${timeKey}_${status}` (timestamp rounded to minute + status only)
- This ensures all participants from the same adjustment batch are grouped together

**Result:**
- Before: "10 adjustments (10 changes)" - each participant shown separately
- After: "6 adjustments (10 changes)" - participants grouped by batch
- Adjustment groups now correctly show "2 participants" with "mixed" type when containing both clawbacks and additional payouts

---

## 2026-01-07 (Create Tab - Add Dollar Amounts to Participant Details)

### Files Changed
- `app/tools/adjustments/page.tsx`

### Summary
Added dollar amount display to the expanded participant rows in the Create Adjustment tab's history section, matching the History tab's design.

### Details
**Problem Solved:**
- The Create Adjustment tab's adjustment history was missing the dollar amount display (`-$1.00` / `+$1.00`) in the expanded participant details
- This was inconsistent with the History tab which shows the adjustment amount

**Changes Made:**
1. Added right-side dollar amount display to each participant row (lines 1418-1425)
2. Dollar amounts show with appropriate color coding:
   - Negative amounts (clawbacks): Red text with `-$X.XX` format
   - Positive amounts (additional): Green text with `+$X.XX` format
3. Uses the existing `MoneyDisplay` component for consistent currency formatting

**Benefits:**
- Consistent design between Create Adjustment tab and History tab
- Users can immediately see the monetary impact of each participant's adjustment
- Clear visual distinction between clawbacks (negative) and additional payouts (positive)

---

## 2026-01-07 (Create Tab - Move Actions to Group Level)

### Files Changed
- `app/tools/adjustments/page.tsx`

### Summary
Refactored the Create tab's adjustment history to move Edit/View actions to the group header level, making participant rows display-only.

### Details
**Problem Solved:**
- Previously, individual participant rows within expanded adjustment groups were clickable
- This was confusing because clicking a single participant opened the dialog with ALL participants
- The Create tab's behavior was inconsistent with the History tab

**Changes Made:**
1. **Added `firstParticipant` variable** (line 1243) - Extract first participant for action button logic
2. **Added group-level Edit/View buttons** (lines 1342-1367) - Moved actions to the adjustment group header
3. **Removed participant row interactivity** - Removed `onClick`, `cursor-pointer`, and hover states
4. **Updated participant styling** - Changed from status-based coloring to adjustment-type-based coloring:
   - Clawback entries: Red background with red border
   - Additional entries: Green background with green border
5. **Removed action icons** - Removed Pencil/Eye icons from individual participant rows

**Benefits:**
- Clearer hierarchy: Actions at group level, display at participant level
- Consistent behavior between Create tab and History tab
- Reduced visual clutter and confusion about what clicking does
- Improved color coding by adjustment type instead of status

---

## 2026-01-07 (History Tab - Grouped Adjustments)

### Files Changed
- `app/tools/adjustments/page.tsx`

### Summary
Updated History tab to show grouped adjustments - one row per batch that expands to show participant details

### Details
**Problem Solved:**
- Previously, the History tab showed separate rows for each participant adjustment
- Now shows one row per adjustment batch (grouped by timestamp/note/status/deal)

**New Structure:**
1. **Adjustment Group Row** - One row per adjustment batch with summary info
2. **Expandable Details** - Click to expand and see individual participant changes
3. **Merge entries** - Still shown as non-expandable single rows

**Features:**
- **Group Header** - Shows date, time, note preview, participant count, type, and status
- **Participant List** - Expanded view shows each participant with their split change and amount
- **Edit/View Buttons** - Opens dialog with all participants from the batch
- **Mixed Type Support** - Groups show "mixed" badge when containing both clawbacks and additional

**Implementation:**
- Added `getGroupedAdjustmentHistory()` function to group all adjustments globally
- Reuses `expandedAdjustmentGroups` state and `toggleAdjustmentGroupExpanded` function
- Merges (participant_merge type) remain ungrouped as single entries
- Groups sorted by date descending (newest first)

---

## 2026-01-07 (Two-Level Expandable Deal History)

### Files Changed
- `app/tools/adjustments/page.tsx`

### Summary
Added two-level expandable hierarchy: Deal → Adjustment Groups → Participant Changes

### Details
**New Structure:**
1. **Level 1: Deal Row** - Click to expand and see all adjustment groups for that deal
2. **Level 2: Adjustment Groups** - Batches of participant changes made together (same timestamp/note)
3. **Level 3: Participant Adjustments** - Individual participant split changes within each group

**New Features:**
- **Adjustment Grouping** - Adjustments are grouped by timestamp (rounded to minute), note, and status
- **Group Header** - Shows date/time, note preview, participant count, adjustment type badge, and status
- **Mixed Type Support** - Groups can show "mixed" when containing both clawbacks and additional adjustments
- **Nested Collapsibles** - Both deal rows and adjustment groups are independently expandable
- **Click-through** - Clicking any participant row opens the dialog with all participants from that group

**Implementation:**
- Added `AdjustmentGroup` interface for typed grouping
- Added `expandedAdjustmentGroups` Set state for second-level expansion
- Added `getDealAdjustmentGroups` function to group adjustments by batch
- Added `toggleAdjustmentGroupExpanded` function for group expansion
- Badge now shows "X adjustments (Y changes)" format with pending indicator

---

## 2026-01-07 (Expandable Deal History - Initial)

### Files Changed
- `app/tools/adjustments/page.tsx`

### Summary
Added expandable deal rows in the Create tab with inline adjustment history

### Details
**New Features:**
1. **Expandable Deal Rows** - Each deal row now has a chevron icon and is clickable to expand/collapse
2. **Inline Adjustment History** - Expanded section shows all past adjustments for that specific deal
3. **History Display** - Each adjustment shows: participant name, old/new split %, adjustment type (clawback/additional), date, and status (pending/confirmed)
4. **Clickable Adjustments** - Click any adjustment entry to open the dialog in view mode (confirmed) or edit mode (pending)
5. **Visual Indicators** - Badge shows adjustment count per deal, with pending count highlighted
6. **Loading States** - Shows loading spinner while fetching history, empty state when no adjustments exist

**Implementation:**
- Added `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent` from shadcn/ui
- Added `ChevronDown`, `ChevronRight` icons from lucide-react
- Added `expandedDeals` Set and `dealHistoryLoading` Set state
- Added `toggleDealExpanded` function to handle expansion and lazy-load history
- Added `getDealAdjustments` helper to filter global history by deal_id
- Used existing `openViewDialogFromHistory` function for clickable entries

---

## 2026-01-07 (Fix)

### Files Changed
- `app/tools/adjustments/page.tsx`

### Summary
Fixed 500 error when submitting adjustments - database constraint violation

### Details
**Issue:** The `entity_type: "adjustment"` value was causing a database constraint violation because the `action_history` table only allows: `deal`, `participant`, `payout`, `assignment`, `event`, `merchant`, `settings`.

**Fix:**
1. Changed `entity_type` from `"adjustment"` to `"deal"` when logging adjustment history
2. Added `adjustment_type` field in `new_data` to distinguish adjustments from regular deal updates
3. Updated history filtering to only include deal entries that have `adjustment_type` in `new_data`

---

## 2026-01-07

### Files Changed
- `app/tools/adjustments/page.tsx`

### Summary
Implemented Create/Edit/View dialog modes for adjustments with pending confirmation workflow

### Details
**New Features:**
1. **Dialog Mode State** - Added `dialogMode` ("create" | "edit" | "view") and `editingAdjustmentIds` state variables to track the current dialog mode and which adjustments are being edited

2. **Status Tracking** - Added `status` field to HistoryItem interface ("pending" | "confirmed") to track adjustment workflow status. New adjustments are created with status "pending"

3. **openViewDialogFromHistory Function** - New async function that opens the adjustment dialog from history entries:
   - Determines mode based on adjustment status (pending = edit, confirmed = view)
   - Fetches deal data if not in local state
   - Populates form with adjustment data
   - Sets appropriate dialog mode

4. **History Tab Enhancements**:
   - Added status badge (Pending/Confirmed) to adjustment entries
   - Added Edit button for pending adjustments
   - Added View button for confirmed adjustments

5. **Dynamic Dialog UI**:
   - Title changes based on mode (Create/Edit/View Adjustment)
   - Description changes based on mode
   - "Add Participant" button hidden in view mode
   - Split input shows as read-only text in view mode
   - Role select shows as read-only text in view mode
   - Remove participant button hidden in view mode
   - Note textarea shows as read-only paragraph in view mode

6. **Footer Button Updates**:
   - Cancel button shows "Close" in view mode
   - Submit button hidden in view mode
   - Submit button text changes to "Update Adjustment" in edit mode

7. **Submit Function Updates**:
   - Logs edit mode actions for tracking
   - Adds status: "pending" to all new adjustment history entries
   - Uses appropriate action_type based on mode
   - Shows mode-specific toast messages

**Icons Added:**
- `Pencil` - For Edit button
- `Eye` - For View button

