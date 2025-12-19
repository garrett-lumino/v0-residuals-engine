"use client"
import { useState, useEffect, forwardRef, useImperativeHandle, useCallback, useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { MoneyDisplay } from "@/components/residuals/shared/MoneyDisplay"
import { AssignmentModal } from "@/components/residuals/payouts/AssignmentModal"
import { EditPendingDealModal } from "@/components/residuals/payouts/EditPendingDealModal"
import { ConfirmedDealViewer } from "@/components/residuals/payouts/ConfirmedDealViewer"
import {
  RefreshCw,
  Trash2,
  Search,
  Pencil,
  ChevronUp,
  ChevronDown,
  ArrowUpDown,
  Clock,
  CheckCircle2,
  AlertCircle,
  Check,
  Loader2,
  RotateCcw,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { toast } from "@/components/ui/use-toast"

interface UnassignedEvent {
  id: string
  batch_id: string
  mid: string | null
  merchant_name: string | null
  date: string | null
  volume: number
  fees: number
  adjustments: number
  chargebacks: number
  raw_data: any
  assignment_status: string
  payout_month: string | null
  assigned_agent_name?: string
  payout_type?: string
  payout_amount?: number
  deal_id?: string | null
}

interface Batch {
  id: string
  batch_id: string
  payout_month: string | null
  created_at: string
}

interface UnassignedQueueProps {
  onUploadSuccess?: () => void
  onRefresh?: () => void
}

export interface UnassignedQueueRef {
  refresh: () => void
}

type SortField = "mid" | "merchant_name" | "date" | "volume" | "fees" | "payout_month" | "payout_type"
type SortDirection = "asc" | "desc"

// Helper to format payout month for display
const formatPayoutMonth = (month: string | null) => {
  if (!month) return "Unknown"
  const [year, monthNum] = month.split("-")
  if (!year || !monthNum) return month
  const date = new Date(Number.parseInt(year), Number.parseInt(monthNum) - 1)
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" })
}

export const UnassignedQueue = forwardRef<UnassignedQueueRef, UnassignedQueueProps>(function UnassignedQueue(
  { onUploadSuccess, onRefresh },
  ref,
) {
  const [events, setEvents] = useState<UnassignedEvent[]>([])
  const [pendingEvents, setPendingEvents] = useState<UnassignedEvent[]>([])
  const [confirmedEvents, setConfirmedEvents] = useState<UnassignedEvent[]>([])
  const [batches, setBatches] = useState<Batch[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [monthFilter, setMonthFilter] = useState("all")
  const [activeTab, setActiveTab] = useState("unassigned")

  const [unassignedSortField, setUnassignedSortField] = useState<SortField>("merchant_name")
  const [unassignedSortDirection, setUnassignedSortDirection] = useState<SortDirection>("asc")
  const [pendingSortField, setPendingSortField] = useState<SortField>("merchant_name")
  const [pendingSortDirection, setPendingSortDirection] = useState<SortDirection>("asc")
  const [confirmedSortField, setConfirmedSortField] = useState<SortField>("merchant_name")
  const [confirmedSortDirection, setConfirmedSortDirection] = useState<SortDirection>("asc")

  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set())
  const [assignModalOpen, setAssignModalOpen] = useState(false)
  const [eventToAssign, setEventToAssign] = useState<UnassignedEvent | null>(null)
  const [bulkAssignMode, setBulkAssignMode] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [eventToDelete, setEventToDelete] = useState<UnassignedEvent | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [stats, setStats] = useState({
    unassigned: { count: 0, volume: 0, payouts: 0 },
    pending: { count: 0, volume: 0, payouts: 0 },
    confirmed: { count: 0, volume: 0, payouts: 0 },
  })

  const [bulkEditModalOpen, setBulkEditModalOpen] = useState(false)
  const [bulkEditMonth, setBulkEditMonth] = useState("")
  const [bulkEditLoading, setBulkEditLoading] = useState(false)

  const [editingEvent, setEditingEvent] = useState<UnassignedEvent | null>(null)
  const [editMid, setEditMid] = useState("")
  const [editMerchantName, setEditMerchantName] = useState("")
  const [isUpdating, setIsUpdating] = useState(false)

  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false)

  const [bulkConfirming, setBulkConfirming] = useState(false)
  const [bulkConfirmDialogOpen, setBulkConfirmDialogOpen] = useState(false)

  // State for viewing confirmed deals
  const [viewerOpen, setViewerOpen] = useState(false)
  const [eventToView, setEventToView] = useState<UnassignedEvent | null>(null)

  useImperativeHandle(ref, () => ({
    refresh: () => {
      fetchData()
    },
  }))

  // Get unique payout months from batches, sorted descending (newest first)
  const uniqueMonths = useMemo(() => {
    const monthsSet = new Set<string>()
    batches.forEach((batch) => {
      if (batch.payout_month) {
        monthsSet.add(batch.payout_month)
      }
    })
    return Array.from(monthsSet).sort((a, b) => b.localeCompare(a))
  }, [batches])

  const fetchData = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        status: activeTab,
        search,
        payout_month: monthFilter !== "all" ? monthFilter : "",
      })

      const [eventsRes, batchesRes] = await Promise.all([
        fetch(`/api/unassigned-events?${params}`),
        fetch("/api/batches"),
      ])

      const eventsData = await eventsRes.json()
      const batchesData = await batchesRes.json()

      if (eventsData.success) {
        const fetchedEvents = eventsData.events || []
        if (activeTab === "unassigned") {
          setEvents(fetchedEvents)
        } else if (activeTab === "pending_confirmation") {
          setPendingEvents(fetchedEvents)
        } else if (activeTab === "confirmed") {
          setConfirmedEvents(fetchedEvents)
        }

        if (eventsData.stats) {
          setStats(eventsData.stats)
        }
      }

      if (batchesData.success) {
        setBatches(batchesData.batches || [])
      }
    } catch (error) {
      console.error("Failed to fetch data:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [activeTab, monthFilter])

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchData()
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  const sortEvents = useCallback((eventsToSort: UnassignedEvent[], field: SortField, direction: SortDirection) => {
    return [...eventsToSort].sort((a, b) => {
      let aVal: any = a[field]
      let bVal: any = b[field]

      // Handle nulls
      if (aVal === null || aVal === undefined) aVal = ""
      if (bVal === null || bVal === undefined) bVal = ""

      // Handle numbers
      if (field === "volume" || field === "fees") {
        aVal = Number(aVal) || 0
        bVal = Number(bVal) || 0
      } else {
        aVal = String(aVal).toLowerCase()
        bVal = String(bVal).toLowerCase()
      }

      if (aVal < bVal) return direction === "asc" ? -1 : 1
      if (aVal > bVal) return direction === "asc" ? 1 : -1
      return 0
    })
  }, [])

  const sortedUnassignedEvents = sortEvents(events, unassignedSortField, unassignedSortDirection)
  const sortedPendingEvents = sortEvents(pendingEvents, pendingSortField, pendingSortDirection)
  const sortedConfirmedEvents = sortEvents(confirmedEvents, confirmedSortField, confirmedSortDirection)

  const toggleSort = (
    field: SortField,
    currentField: SortField,
    currentDirection: SortDirection,
    setField: (f: SortField) => void,
    setDirection: (d: SortDirection) => void,
  ) => {
    if (currentField === field) {
      setDirection(currentDirection === "asc" ? "desc" : "asc")
    } else {
      setField(field)
      setDirection("asc")
    }
  }

  const SortableHeader = ({
    field,
    label,
    currentField,
    currentDirection,
    onSort,
    className = "",
  }: {
    field: SortField
    label: string
    currentField: SortField
    currentDirection: SortDirection
    onSort: (field: SortField) => void
    className?: string
  }) => (
    <TableHead className={`cursor-pointer hover:bg-muted/50 select-none ${className}`} onClick={() => onSort(field)}>
      <div className="flex items-center gap-1">
        {label}
        {currentField === field ? (
          currentDirection === "asc" ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )
        ) : (
          <ArrowUpDown className="h-4 w-4 text-muted-foreground/50" />
        )}
      </div>
    </TableHead>
  )

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const currentEvents =
        activeTab === "unassigned" ? events : activeTab === "pending_confirmation" ? pendingEvents : confirmedEvents
      setSelectedEvents(new Set(currentEvents.map((e) => e.id)))
    } else {
      setSelectedEvents(new Set())
    }
  }

  const handleSelectEvent = (eventId: string, checked: boolean) => {
    const newSelected = new Set(selectedEvents)
    if (checked) {
      newSelected.add(eventId)
    } else {
      newSelected.delete(eventId)
    }
    setSelectedEvents(newSelected)
  }

  const handleAssignClick = (event: UnassignedEvent) => {
    setEventToAssign(event)
    setBulkAssignMode(false)
    setAssignModalOpen(true)
  }

  const handleBulkAssign = () => {
    if (selectedEvents.size === 0) return
    setBulkAssignMode(true)
    setAssignModalOpen(true)
  }

  const handleAssignmentComplete = () => {
    setAssignModalOpen(false)
    setEventToAssign(null)
    setBulkAssignMode(false)
    setSelectedEvents(new Set())
    fetchData()
    onUploadSuccess?.()
  }

  const handleConfirmSingle = async (event: UnassignedEvent) => {
    try {
      const response = await fetch("/api/confirm-assignment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_ids: [event.id] }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Failed to confirm assignment")
      }

      toast({
        title: "Assignment confirmed",
        description: `${event.merchant_name || event.mid} has been confirmed.`,
      })

      fetchData()
      onUploadSuccess?.()
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to confirm assignment",
        variant: "destructive",
      })
    }
  }

  /**
   * Undo assignment - returns event from pending_confirmation back to unassigned
   */
  const handleUndoAssignment = async (event: UnassignedEvent) => {
    try {
      // First, get the deal_id for this event
      if (!event.deal_id) {
        // No deal_id - just reset the event directly
        const response = await fetch(`/api/unassigned-events/${event.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            assignment_status: "unassigned",
            deal_id: null,
            assigned_agent_id: null,
            assigned_agent_name: null,
          }),
        })

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || "Failed to reset event")
        }
      } else {
        // Has a deal_id - use the reject endpoint to properly clean up
        const response = await fetch(`/api/deals/${event.deal_id}/reject`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId: event.id }),
        })

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || "Failed to undo assignment")
        }
      }

      toast({
        title: "Assignment Undone",
        description: `${event.merchant_name || event.mid} has been returned to unassigned.`,
      })

      fetchData()
      onUploadSuccess?.()
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to undo assignment",
        variant: "destructive",
      })
    }
  }

  /**
   * Unconfirm - revert confirmed event back to pending_confirmation
   */
  const handleUnconfirm = async (event: UnassignedEvent) => {
    try {
      const response = await fetch("/api/unconfirm-assignment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_ids: [event.id] }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Failed to unconfirm")
      }

      toast({
        title: "Confirmation Reverted",
        description: `${event.merchant_name || event.mid} moved back to pending confirmation.`,
      })

      fetchData()
      onUploadSuccess?.()
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to unconfirm",
        variant: "destructive",
      })
    }
  }

  /**
   * Open the ConfirmedDealViewer modal for a specific event
   */
  const handleViewClick = (event: UnassignedEvent) => {
    setEventToView(event)
    setViewerOpen(true)
  }

  const handleDeleteClick = (event: UnassignedEvent) => {
    setEventToDelete(event)
    setDeleteDialogOpen(true)
  }

  const confirmDelete = async () => {
    if (!eventToDelete) return
    setDeleting(true)
    try {
      // For confirmed events, use the /delete endpoint with POST (to bypass parent route's status check)
      // For unassigned/pending events, use the regular DELETE endpoint
      const isConfirmed = eventToDelete.assignment_status === "confirmed"
      const url = isConfirmed
        ? `/api/unassigned-events/${eventToDelete.id}/delete`
        : `/api/unassigned-events/${eventToDelete.id}`
      const method = isConfirmed ? "POST" : "DELETE"

      const res = await fetch(url, { method })
      if (res.ok) {
        toast({
          title: "Deleted",
          description: `Successfully deleted event`,
        })
        fetchData()
      } else {
        const data = await res.json()
        toast({
          title: "Delete Failed",
          description: data.error || "Failed to delete event",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Failed to delete event:", error)
      toast({
        title: "Error",
        description: "An unexpected error occurred",
        variant: "destructive",
      })
    } finally {
      setDeleting(false)
      setDeleteDialogOpen(false)
      setEventToDelete(null)
    }
  }

  const handleBulkDeleteClick = () => {
    if (selectedEvents.size === 0) return
    setBulkDeleteDialogOpen(true)
  }

  const confirmBulkDelete = async () => {
    if (selectedEvents.size === 0) return
    setBulkDeleting(true)
    try {
      const res = await fetch("/api/residuals/events/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedEvents) }),
      })
      const data = await res.json()
      if (res.ok) {
        toast({
          title: "Deleted",
          description: `Successfully deleted ${data.deleted} event(s)`,
        })
        setSelectedEvents(new Set())
        fetchData()
      } else {
        toast({
          title: "Error",
          description: data.error || "Failed to delete events",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Failed to bulk delete events:", error)
      toast({
        title: "Error",
        description: "Failed to delete events",
        variant: "destructive",
      })
    } finally {
      setBulkDeleting(false)
      setBulkDeleteDialogOpen(false)
    }
  }

  const handleBulkEditPayoutMonth = async () => {
    if (!bulkEditMonth || selectedEvents.size === 0) return

    setBulkEditLoading(true)
    try {
      const response = await fetch("/api/residuals/events/bulk-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventIds: Array.from(selectedEvents),
          payout_month: bulkEditMonth,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Failed to update events")
      }

      const result = await response.json()
      toast({
        title: "Events Updated",
        description: `Successfully updated payout month for ${result.updated} events to ${bulkEditMonth}`,
      })

      setBulkEditModalOpen(false)
      setBulkEditMonth("")
      setSelectedEvents(new Set())
      fetchData()
    } catch (error) {
      console.error("[v0] Bulk edit error:", error)
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update events",
        variant: "destructive",
      })
    } finally {
      setBulkEditLoading(false)
    }
  }

  const handleEditClick = (event: UnassignedEvent) => {
    setEditingEvent(event)
    setEditMid(event.mid || "")
    setEditMerchantName(event.merchant_name || "")
  }

  const handleSaveEdit = async () => {
    if (!editingEvent) return

    setIsUpdating(true)
    try {
      const res = await fetch(`/api/unassigned-events/${editingEvent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mid: editMid, merchant_name: editMerchantName }),
      })

      if (!res.ok) throw new Error("Failed to update")

      toast({ title: "Event updated", description: "Merchant details have been saved." })
      setEditingEvent(null)
      onRefresh?.()
    } catch (error) {
      toast({ title: "Error", description: "Failed to update event", variant: "destructive" })
    } finally {
      setIsUpdating(false)
    }
  }

  const handleBulkConfirmClick = () => {
    if (selectedEvents.size === 0) return
    setBulkConfirmDialogOpen(true)
  }

  const confirmBulkConfirm = async () => {
    if (selectedEvents.size === 0) return
    setBulkConfirming(true)
    try {
      const res = await fetch("/api/confirm-assignment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_ids: Array.from(selectedEvents) }),
      })
      const data = await res.json()
      if (res.ok) {
        toast({
          title: "Confirmed",
          description: `Successfully confirmed ${data.confirmed} event(s)${data.airtable_synced ? ` and synced ${data.airtable_synced} to Airtable` : ""}`,
        })
        setSelectedEvents(new Set())
        fetchData()
        onUploadSuccess?.()
      } else {
        toast({
          title: "Error",
          description: data.error || "Failed to confirm events",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Failed to bulk confirm events:", error)
      toast({
        title: "Error",
        description: "Failed to confirm events",
        variant: "destructive",
      })
    } finally {
      setBulkConfirming(false)
      setBulkConfirmDialogOpen(false)
    }
  }

  const currentEvents =
    activeTab === "unassigned" ? events : activeTab === "pending_confirmation" ? pendingEvents : confirmedEvents
  const allSelected = currentEvents.length > 0 && selectedEvents.size === currentEvents.length
  const someSelected = selectedEvents.size > 0 && selectedEvents.size < currentEvents.length

  const renderEventsTable = (
    eventsToRender: UnassignedEvent[],
    sortField: SortField,
    sortDirection: SortDirection,
    onSortChange: (field: SortField) => void,
    showActions = true,
  ) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[50px]">
            <Checkbox
              checked={allSelected ? true : someSelected ? "indeterminate" : false}
              onCheckedChange={handleSelectAll}
            />
          </TableHead>
          <SortableHeader
            field="mid"
            label="MID"
            currentField={sortField}
            currentDirection={sortDirection}
            onSort={onSortChange}
          />
          <SortableHeader
            field="merchant_name"
            label="Merchant"
            currentField={sortField}
            currentDirection={sortDirection}
            onSort={onSortChange}
          />
          <SortableHeader
            field="payout_month"
            label="Payout Month"
            currentField={sortField}
            currentDirection={sortDirection}
            onSort={onSortChange}
          />
          <SortableHeader
            field="volume"
            label="Volume"
            currentField={sortField}
            currentDirection={sortDirection}
            onSort={onSortChange}
            className="text-right"
          />
          <SortableHeader
            field="fees"
            label="Fees"
            currentField={sortField}
            currentDirection={sortDirection}
            onSort={onSortChange}
            className="text-right"
          />
          {activeTab === "confirmed" && (
            <SortableHeader
              field="payout_type"
              label="Deal Type"
              currentField={sortField}
              currentDirection={sortDirection}
              onSort={onSortChange}
            />
          )}
          {showActions && <TableHead className="text-right">Actions</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {eventsToRender.length === 0 ? (
          <TableRow>
            <TableCell colSpan={showActions ? (activeTab === "confirmed" ? 8 : 7) : (activeTab === "confirmed" ? 7 : 6)} className="text-center py-8 text-muted-foreground">
              No events found
            </TableCell>
          </TableRow>
        ) : (
          eventsToRender.map((event) => (
            <TableRow key={event.id}>
              <TableCell>
                <Checkbox
                  checked={selectedEvents.has(event.id)}
                  onCheckedChange={(checked) => handleSelectEvent(event.id, checked as boolean)}
                />
              </TableCell>
              <TableCell className="font-mono text-sm">{event.mid || "-"}</TableCell>
              <TableCell className="font-medium">{event.merchant_name || "Unknown"}</TableCell>
              <TableCell>{formatPayoutMonth(event.payout_month)}</TableCell>
              <TableCell className="text-right">
                <MoneyDisplay amount={event.volume} showZero />
              </TableCell>
              <TableCell className="text-right">
                <MoneyDisplay amount={event.fees} showZero />
              </TableCell>
              {activeTab === "confirmed" && (
                <TableCell>
                  <Badge variant="outline" className="capitalize">
                    {(() => {
                      const type = event.payout_type?.toLowerCase() || "residual"
                      if (type.includes("trueup")) return "Trueup"
                      if (type.includes("bonus")) return "Bonus"
                      if (type.includes("residual")) return "Residual"
                      if (type.includes("upfront")) return "Upfront"
                      return event.payout_type || "Residual"
                    })()}
                  </Badge>
                </TableCell>
              )}
              {showActions && (
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEditClick(event)}
                      title="Edit merchant details"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {activeTab === "unassigned" && (
                      <Button size="sm" onClick={() => handleAssignClick(event)}>
                        Assign
                      </Button>
                    )}
                    {activeTab === "pending_confirmation" && (
                      <>
                        <Button
                          size="sm"
                          onClick={() => handleConfirmSingle(event)}
                          className="bg-green-600 hover:bg-green-700 text-white"
                        >
                          <Check className="h-4 w-4 mr-1" />
                          Confirm
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => handleAssignClick(event)}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleUndoAssignment(event)}
                          className="border-orange-500 text-orange-600 hover:bg-orange-50"
                        >
                          <RotateCcw className="h-4 w-4 mr-1" />
                          Undo
                        </Button>
                      </>
                    )}
                    {activeTab === "confirmed" && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleUnconfirm(event)}
                          className="border-orange-500 text-orange-600 hover:bg-orange-50"
                        >
                          <RotateCcw className="h-4 w-4 mr-1" />
                          Unconfirm
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => handleViewClick(event)}>
                          View
                        </Button>
                      </>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => handleDeleteClick(event)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              )}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  )

  return (
    <div className="space-y-6">
      <Tabs
        value={activeTab}
        onValueChange={(v) => {
          setActiveTab(v)
          setSelectedEvents(new Set())
        }}
      >
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="unassigned" className="gap-2">
            <AlertCircle className="h-4 w-4" />
            Unassigned ({stats.unassigned.count})
          </TabsTrigger>
          <TabsTrigger value="pending_confirmation" className="gap-2">
            <Clock className="h-4 w-4" />
            Pending Confirmation ({stats.pending.count})
          </TabsTrigger>
          <TabsTrigger value="confirmed" className="gap-2">
            <CheckCircle2 className="h-4 w-4" />
            Confirmed ({stats.confirmed.count})
          </TabsTrigger>
        </TabsList>

        {/* All tabs share the same content structure */}
        {["unassigned", "pending_confirmation", "confirmed"].map((tabValue) => (
          <TabsContent key={tabValue} value={tabValue} className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>
                  {tabValue === "unassigned" && "Unassigned Events"}
                  {tabValue === "pending_confirmation" && "Pending Confirmation"}
                  {tabValue === "confirmed" && "Confirmed Events"}
                </CardTitle>
                <CardDescription>
                  {tabValue === "unassigned" && "Events that need participant assignment"}
                  {tabValue === "pending_confirmation" && "Events awaiting confirmation before payout generation"}
                  {tabValue === "confirmed" && "Events that have been confirmed and processed"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Filters */}
                <div className="flex flex-wrap gap-4 items-end">
                  <div className="flex-1 min-w-[200px]">
                    <Label className="text-sm font-medium">Search</Label>
                    <div className="relative mt-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search by MID or merchant..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-9"
                      />
                    </div>
                  </div>
                  <div className="w-[200px]">
                    <Label className="text-sm font-medium">Payout Month</Label>
                    <div className="flex gap-2 mt-1">
                      <Select value={monthFilter} onValueChange={setMonthFilter}>
                        <SelectTrigger>
                          <SelectValue placeholder="All Months" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Months</SelectItem>
                          {uniqueMonths.map((month) => (
                            <SelectItem key={month} value={month}>
                              {formatPayoutMonth(month)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <Button variant="outline" onClick={fetchData} disabled={loading}>
                    <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                    Refresh
                  </Button>
                  {tabValue === "unassigned" && selectedEvents.size > 0 && (
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setBulkEditMonth("")
                          setBulkEditModalOpen(true)
                        }}
                      >
                        <Pencil className="h-4 w-4 mr-2" />
                        Bulk Edit ({selectedEvents.size})
                      </Button>
                      <Button
                        variant="outline"
                        className="text-red-600 hover:text-red-700 hover:bg-red-50 bg-transparent"
                        onClick={handleBulkDeleteClick}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Bulk Delete ({selectedEvents.size})
                      </Button>
                      <Button onClick={handleBulkAssign}>Bulk Assign ({selectedEvents.size})</Button>
                    </div>
                  )}
                  {tabValue === "pending_confirmation" && selectedEvents.size > 0 && (
                    <div className="flex gap-2">
                      <Button onClick={handleBulkConfirmClick} className="bg-green-600 hover:bg-green-700 text-white">
                        <Check className="h-4 w-4 mr-2" />
                        Confirm Selected ({selectedEvents.size})
                      </Button>
                      <Button
                        variant="outline"
                        className="text-red-600 hover:text-red-700 hover:bg-red-50 bg-transparent"
                        onClick={handleBulkDeleteClick}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete Selected ({selectedEvents.size})
                      </Button>
                    </div>
                  )}
                </div>

                {/* Table */}
                {loading ? (
                  <div className="flex items-center justify-center py-8">
                    <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <>
                    {tabValue === "unassigned" &&
                      renderEventsTable(sortedUnassignedEvents, unassignedSortField, unassignedSortDirection, (field) =>
                        toggleSort(
                          field,
                          unassignedSortField,
                          unassignedSortDirection,
                          setUnassignedSortField,
                          setUnassignedSortDirection,
                        ),
                      )}
                    {tabValue === "pending_confirmation" &&
                      renderEventsTable(sortedPendingEvents, pendingSortField, pendingSortDirection, (field) =>
                        toggleSort(
                          field,
                          pendingSortField,
                          pendingSortDirection,
                          setPendingSortField,
                          setPendingSortDirection,
                        ),
                      )}
                    {tabValue === "confirmed" &&
                      renderEventsTable(sortedConfirmedEvents, confirmedSortField, confirmedSortDirection, (field) =>
                        toggleSort(
                          field,
                          confirmedSortField,
                          confirmedSortDirection,
                          setConfirmedSortField,
                          setConfirmedSortDirection,
                        ),
                      )}
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>

      {/* Assignment Modal - only show for non-pending_confirmation tabs */}
      {activeTab !== "pending_confirmation" && (
        <AssignmentModal
          open={assignModalOpen}
          onOpenChange={setAssignModalOpen}
          event={bulkAssignMode ? null : eventToAssign}
          bulkEventIds={bulkAssignMode ? Array.from(selectedEvents) : undefined}
          onComplete={handleAssignmentComplete}
        />
      )}

      {/* Edit Pending Deal Modal - only for pending_confirmation tab */}
      {activeTab === "pending_confirmation" && eventToAssign && (
        <EditPendingDealModal
          event={eventToAssign}
          isOpen={assignModalOpen}
          onClose={() => setAssignModalOpen(false)}
          onComplete={handleAssignmentComplete}
        />
      )}

      {/* Confirmed Deal Viewer - single event modal */}
      {eventToView && (
        <ConfirmedDealViewer
          event={eventToView}
          isOpen={viewerOpen}
          onClose={() => {
            setViewerOpen(false)
            setEventToView(null)
          }}
          onComplete={() => {
            fetchData()
            onUploadSuccess?.()
          }}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Event</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <span>Are you sure you want to delete this event? This action cannot be undone.</span>
                {eventToDelete && (
                  <div className="mt-2 p-2 bg-muted rounded text-sm">
                    <div>
                      <strong>MID:</strong> {eventToDelete.mid}
                    </div>
                    <div>
                      <strong>Merchant:</strong> {eventToDelete.merchant_name}
                    </div>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Delete Confirmation Dialog */}
      <AlertDialog open={bulkDeleteDialogOpen} onOpenChange={setBulkDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedEvents.size} Events?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {selectedEvents.size} selected event(s). This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmBulkDelete}
              disabled={bulkDeleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {bulkDeleting ? "Deleting..." : `Delete ${selectedEvents.size} Events`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Confirm Dialog */}
      <AlertDialog open={bulkConfirmDialogOpen} onOpenChange={setBulkConfirmDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm {selectedEvents.size} Events?</AlertDialogTitle>
            <AlertDialogDescription>
              This will confirm all selected events and sync them to Airtable. This action marks them as ready for
              payout.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkConfirming}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmBulkConfirm}
              disabled={bulkConfirming}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              {bulkConfirming ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
              {bulkConfirming ? "Confirming..." : "Confirm All"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Edit Modal */}
      <Dialog open={bulkEditModalOpen} onOpenChange={setBulkEditModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk Edit Payout Month</DialogTitle>
            <DialogDescription>
              Change the payout month for {selectedEvents.size} selected event{selectedEvents.size !== 1 ? "s" : ""}.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="payout-month">New Payout Month</Label>
            <Input
              id="payout-month"
              type="month"
              value={bulkEditMonth}
              onChange={(e) => setBulkEditMonth(e.target.value)}
              className="mt-2"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkEditModalOpen(false)} disabled={bulkEditLoading}>
              Cancel
            </Button>
            <Button onClick={handleBulkEditPayoutMonth} disabled={!bulkEditMonth || bulkEditLoading}>
              {bulkEditLoading ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Updating...
                </>
              ) : (
                `Update ${selectedEvents.size} Event${selectedEvents.size !== 1 ? "s" : ""}`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingEvent} onOpenChange={(open) => !open && setEditingEvent(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Merchant Details</DialogTitle>
            <DialogDescription>Update the MID or merchant name for this event.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-mid">MID</Label>
              <Input
                id="edit-mid"
                value={editMid}
                onChange={(e) => setEditMid(e.target.value)}
                placeholder="Enter MID"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-merchant">Merchant Name</Label>
              <Input
                id="edit-merchant"
                value={editMerchantName}
                onChange={(e) => setEditMerchantName(e.target.value)}
                placeholder="Enter merchant name"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingEvent(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={isUpdating}>
              {isUpdating ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
})
