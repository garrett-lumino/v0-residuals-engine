# Feature: Adjustment Dialog View/Edit Modes

## Overview
Enhance the adjustment dialog in `app/tools/adjustments/page.tsx` to support three modes:
- **Create**: New adjustment (current behavior)
- **Edit**: Modify pending adjustments before confirmation
- **View**: Read-only view of confirmed/rejected adjustments from history

## File to Modify
`app/tools/adjustments/page.tsx`

---

## Implementation Steps

### Step 1: Add New State Variables
Add these state variables near the existing dialog state (around line 211-220):

```typescript
const [dialogMode, setDialogMode] = useState<"create" | "edit" | "view">("create")
const [editingAdjustmentIds, setEditingAdjustmentIds] = useState<string[]>([])
```

### Step 2: Create Helper Function to Open Dialog from History
Add a function `openViewDialogFromHistory` that:
1. Accepts an array of adjustment records and a deal ID
2. Fetches the deal data using the deal ID
3. Sets the dialog mode to "view" or "edit" based on adjustment status
4. Populates `adjustmentParticipants` from the adjustment records
5. Populates `adjustmentNote` from the first adjustment's note
6. Opens the dialog

```typescript
const openViewDialogFromHistory = async (
  adjustments: Array<{ id: string; new_data?: any }>,
  dealId: string
) => {
  // Fetch deal by ID
  // Determine mode: "edit" if all pending, "view" otherwise
  // Populate adjustmentParticipants from adjustments
  // Set adjustmentNote
  // Set editingAdjustmentIds if editing
  // Open dialog
}
```

### Step 3: Update the Expandable History Section (Create Tab)
Location: Inside the deal row expansion showing adjustment history (around line 1300-1370)

Changes:
1. **Remove** the "Undo" button for confirmed adjustments
2. **Add** an "Edit" button for pending adjustments only
3. The Edit button should call `openViewDialogFromHistory` with the pending adjustments

```tsx
{/* Edit button for pending adjustments only */}
{status === "pending" && (
  <Button
    variant="ghost"
    size="sm"
    className="h-5 px-1.5 text-[10px] text-orange-600 hover:text-orange-700 hover:bg-orange-50"
    onClick={(e) => {
      e.stopPropagation()
      // Find pending adjustments for this deal and open edit dialog
      openViewDialogFromHistory(pendingAdjustments, dealId)
    }}
  >
    Edit
  </Button>
)}
```

### Step 4: Update Dialog Title and Description
Location: Inside the Dialog component, DialogHeader section

```tsx
<DialogTitle>
  {dialogMode === "view" && "View Adjustment"}
  {dialogMode === "edit" && "Edit Pending Adjustment"}
  {dialogMode === "create" && "Create Adjustment"}
  {" for "}{selectedDeal?.merchant_name || selectedDeal?.deal_id}
</DialogTitle>
<DialogDescription>
  {dialogMode === "view" && "Review the adjustment details (read-only)"}
  {dialogMode === "edit" && "Modify the pending adjustment before confirmation"}
  {dialogMode === "create" && "Modify participant splits to generate clawback or additional payout records"}
</DialogDescription>
```

### Step 5: Make Inputs Read-Only in View Mode
For the split percentage input:
```tsx
{dialogMode === "view" ? (
  <span className="text-sm font-medium">{participant.new_split_pct}%</span>
) : (
  <Input ... />
)}
```

For the note textarea:
```tsx
<Label>Note {dialogMode !== "view" && "(optional)"}</Label>
{dialogMode === "view" ? (
  <p className="text-sm text-muted-foreground italic">
    {adjustmentNote || "No note provided"}
  </p>
) : (
  <Textarea ... />
)}
```

### Step 6: Update Dialog Footer Buttons
```tsx
<DialogFooter>
  <Button variant="outline" onClick={() => setDialogOpen(false)}>
    {dialogMode === "view" ? "Close" : "Cancel"}
  </Button>
  {dialogMode !== "view" && (
    <Button onClick={submitAdjustment} disabled={...}>
      {submitting ? (
        dialogMode === "edit" ? "Updating..." : "Submitting..."
      ) : (
        dialogMode === "edit" ? "Update Adjustment" : "Submit Adjustment"
      )}
    </Button>
  )}
</DialogFooter>
```

### Step 7: Update Submit Function for Edit Mode
Modify `submitAdjustment` to handle edit mode:
- If `dialogMode === "edit"` and `editingAdjustmentIds.length > 0`:
  - Delete existing pending adjustments first, OR
  - Call an update endpoint instead of create

### Step 8: Remove Unused Code
Remove the `handleUndoConfirmation` function if no longer used after removing the Undo button.

---

## Testing Checklist
- [ ] Create mode works as before
- [ ] Clicking "Edit" on pending adjustment opens dialog in edit mode
- [ ] Edit mode allows modifying splits and note
- [ ] View mode shows read-only data for confirmed/rejected adjustments
- [ ] Submit button text changes based on mode
- [ ] Close/Cancel button text changes based on mode
- [ ] All inputs are read-only in view mode

