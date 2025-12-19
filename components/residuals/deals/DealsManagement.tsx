"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Checkbox } from "@/components/ui/checkbox"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Label } from "@/components/ui/label"
import {
  Search,
  Trash2,
  Eye,
  Loader2,
  Users,
  DollarSign,
  Check,
  ChevronDown,
  ChevronUp,
  ArrowUpDown,
} from "lucide-react"

interface Participant {
  split_pct: number
  partner_name: string
  partner_role: string
  partner_email?: string
  partner_airtable_id: string
}

interface Deal {
  id: string
  deal_id: string
  mid: string
  merchant_name: string | null
  effective_date: string | null
  payout_type: string
  participants_json: Participant[]
  assigned_agent_name: string | null
  created_at: string
  updated_at: string
  is_legacy_import: boolean
  available_to_purchase: boolean
  paid_status: string // "paid" | "unpaid"
}

type SortField = "mid" | "merchant_name" | "participants" | "payout_type" | "created_at" | "paid_status"
type SortDirection = "asc" | "desc"

export function DealsManagement() {
  const [deals, setDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [total, setTotal] = useState(0)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const loadMoreRef = useRef<HTMLDivElement | null>(null)

  // Delete state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [dealToDelete, setDealToDelete] = useState<Deal | null>(null)
  const [deleting, setDeleting] = useState(false)

  // View state
  const [viewDialogOpen, setViewDialogOpen] = useState(false)
  const [dealToView, setDealToView] = useState<Deal | null>(null)
  const [additionalDetailsOpen, setAdditionalDetailsOpen] = useState(false)

  // Edit state
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [dealToEdit, setDealToEdit] = useState<Deal | null>(null)
  const [saving, setSaving] = useState(false)

  const [markPaidDialogOpen, setMarkPaidDialogOpen] = useState(false)
  const [dealToMarkPaid, setDealToMarkPaid] = useState<Deal | null>(null)
  const [markingPaid, setMarkingPaid] = useState(false)

  // Sort state
  const [sortField, setSortField] = useState<SortField>("created_at")
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc")

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
      setDeals([])
      setHasMore(true)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  const fetchDeals = useCallback(
    async (pageNum: number, isLoadMore = false) => {
      if (isLoadMore) {
        setLoadingMore(true)
      } else {
        setLoading(true)
      }

      try {
        const params = new URLSearchParams({
          list: "true",
          page: pageNum.toString(),
          limit: "100",
          search: debouncedSearch,
        })

        const res = await fetch(`/api/residuals/deals?${params}`)
        const json = await res.json()

        if (json.success) {
          if (isLoadMore) {
            // Deduplicate by ID to prevent React key errors from race conditions
            setDeals((prev) => {
              const existingIds = new Set(prev.map((d) => d.id))
              const newDeals = json.data.filter((d: Deal) => !existingIds.has(d.id))
              return [...prev, ...newDeals]
            })
          } else {
            setDeals(json.data)
          }
          setTotal(json.pagination.total)
          setHasMore(json.data.length === 100 && pageNum < json.pagination.totalPages)
        }
      } catch (error) {
        console.error("Error fetching deals:", error)
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [debouncedSearch],
  )

  // Initial load and search changes
  useEffect(() => {
    fetchDeals(1, false)
  }, [debouncedSearch, fetchDeals])

  // Infinite scroll observer
  useEffect(() => {
    if (observerRef.current) {
      observerRef.current.disconnect()
    }

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading && !loadingMore) {
          setPage((prev) => {
            const nextPage = prev + 1
            fetchDeals(nextPage, true)
            return nextPage
          })
        }
      },
      { threshold: 0.1 },
    )

    if (loadMoreRef.current) {
      observerRef.current.observe(loadMoreRef.current)
    }

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect()
      }
    }
  }, [hasMore, loading, loadingMore, fetchDeals])

  const handleDelete = async () => {
    if (!dealToDelete) return

    setDeleting(true)
    try {
      const res = await fetch(`/api/residuals/deals/${dealToDelete.id}`, {
        method: "DELETE",
      })
      const json = await res.json()

      if (json.success) {
        setDeals([])
        setPage(1)
        fetchDeals(1, false)
      }
    } catch (error) {
      console.error("Error deleting deal:", error)
    } finally {
      setDeleting(false)
      setDeleteDialogOpen(false)
      setDealToDelete(null)
    }
  }

  const handleSaveEdit = async () => {
    if (!dealToEdit) return

    setSaving(true)
    try {
      const res = await fetch(`/api/residuals/deals/${dealToEdit.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payout_type: dealToEdit.payout_type,
          participants_json: dealToEdit.participants_json,
          available_to_purchase: dealToEdit.available_to_purchase, // include in save
        }),
      })
      const json = await res.json()

      if (json.success) {
        setDeals([])
        setPage(1)
        fetchDeals(1, false)
        setEditDialogOpen(false)
        setDealToEdit(null)
      }
    } catch (error) {
      console.error("Error updating deal:", error)
    } finally {
      setSaving(false)
    }
  }

  const handleMarkAsPaid = async () => {
    if (!dealToMarkPaid) return

    setMarkingPaid(true)
    try {
      const res = await fetch(`/api/residuals/deals/${dealToMarkPaid.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paid_status: "paid",
        }),
      })
      const json = await res.json()

      if (json.success) {
        // Update local state
        setDeals((prev) => prev.map((d) => (d.id === dealToMarkPaid.id ? { ...d, paid_status: "paid" } : d)))
        setMarkPaidDialogOpen(false)
        setDealToMarkPaid(null)
      }
    } catch (error) {
      console.error("Error marking deal as paid:", error)
    } finally {
      setMarkingPaid(false)
    }
  }

  const handleViewToggleAvailable = async (checked: boolean) => {
    if (!dealToView) return

    const mid = dealToView.mid

    setDealToView({ ...dealToView, available_to_purchase: checked })
    setDeals((prev) => prev.map((d) => (d.mid === mid ? { ...d, available_to_purchase: checked } : d)))

    try {
      const res = await fetch(`/api/residuals/deals/by-mid/${mid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ available_to_purchase: checked }),
      })
      if (!res.ok) {
        // Revert ALL deals with this MID on failure
        setDealToView({ ...dealToView, available_to_purchase: !checked })
        setDeals((prev) => prev.map((d) => (d.mid === mid ? { ...d, available_to_purchase: !checked } : d)))
      }
    } catch (error) {
      console.error("Error toggling available to purchase:", error)
      // Revert ALL deals with this MID on error
      setDealToView({ ...dealToView, available_to_purchase: !checked })
      setDeals((prev) => prev.map((d) => (d.mid === mid ? { ...d, available_to_purchase: !checked } : d)))
    }
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "-"
    return new Date(dateStr).toLocaleDateString()
  }

  const formatDateTime = (dateStr: string | null) => {
    if (!dateStr) return "-"
    return new Date(dateStr).toLocaleString()
  }

  const getPayoutMonth = (dateStr: string | null) => {
    if (!dateStr) return "-"
    const date = new Date(dateStr)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
  }

  const getTotalSplit = (participants: Participant[]) => {
    if (!participants || participants.length === 0) return 0
    return participants.reduce((sum, p) => sum + (p.split_pct || 0), 0)
  }

  const sortedDeals = [...deals].sort((a, b) => {
    let aVal: any
    let bVal: any

    switch (sortField) {
      case "mid":
        aVal = a.mid || ""
        bVal = b.mid || ""
        break
      case "merchant_name":
        aVal = a.merchant_name || ""
        bVal = b.merchant_name || ""
        break
      case "participants":
        aVal = a.participants_json?.length || 0
        bVal = b.participants_json?.length || 0
        break
      case "payout_type":
        aVal = a.payout_type || ""
        bVal = b.payout_type || ""
        break
      case "created_at":
        aVal = a.created_at || ""
        bVal = b.created_at || ""
        break
      case "paid_status":
        aVal = a.paid_status || ""
        bVal = b.paid_status || ""
        break
      default:
        aVal = ""
        bVal = ""
    }

    if (sortField === "participants") {
      // Already numbers
    } else {
      aVal = String(aVal).toLowerCase()
      bVal = String(bVal).toLowerCase()
    }

    if (aVal < bVal) return sortDirection === "asc" ? -1 : 1
    if (aVal > bVal) return sortDirection === "asc" ? 1 : -1
    return 0
  })

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc")
    } else {
      setSortField(field)
      setSortDirection("asc")
    }
  }

  const SortableHeader = ({
    field,
    label,
    className = "",
  }: {
    field: SortField
    label: string
    className?: string
  }) => (
    <TableHead
      className={`cursor-pointer hover:bg-muted/50 select-none ${className}`}
      onClick={() => toggleSort(field)}
    >
      <div className="flex items-center gap-1">
        {label}
        {sortField === field ? (
          sortDirection === "asc" ? (
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

  return (
    <div className="space-y-6">
      {/* Deals Table Card */}
      <Card>
        <CardHeader>
          <CardTitle>Deals Management</CardTitle>
          <CardDescription>View and manage all merchant deals</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Search */}
          <div className="mb-4">
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by MID, merchant name, or agent..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          {/* Table */}
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHeader field="mid" label="MID" />
                  <SortableHeader field="merchant_name" label="Merchant" />
                  <SortableHeader field="participants" label="Participants" />
                  <SortableHeader field="payout_type" label="Payout Type" />
                  <SortableHeader field="created_at" label="Created" />
                  <SortableHeader field="paid_status" label="Mark as Paid" />
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && deals.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                    </TableCell>
                  </TableRow>
                ) : sortedDeals.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                      No deals found
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedDeals.map((deal) => {
                    const totalSplit = deal.participants_json?.reduce((sum, p) => sum + (p.split_pct || 0), 0) || 0
                    const participantNames = deal.participants_json
                      ?.map((p) => `${p.partner_name || "Unknown"} (${p.split_pct}%)`)
                      .join(", ")

                    return (
                      <TableRow key={deal.id}>
                        <TableCell className="font-mono">{deal.mid}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{deal.merchant_name || "Unknown"}</span>
                            {deal.available_to_purchase && (
                              <Badge variant="default" className="bg-green-600 text-xs">
                                Available
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Users className="h-4 w-4 text-muted-foreground" />
                            <span>{deal.participants_json?.length || 0}</span>
                            <Badge variant={totalSplit === 100 ? "default" : "destructive"} className="text-xs">
                              {totalSplit}%
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{deal.payout_type}</Badge>
                        </TableCell>
                        <TableCell>{new Date(deal.created_at).toLocaleDateString()}</TableCell>
                        <TableCell>
                          {deal.paid_status === "paid" ? (
                            <div className="flex items-center gap-1.5 text-green-600">
                              <div className="h-6 w-6 rounded-full bg-green-100 flex items-center justify-center">
                                <Check className="h-4 w-4" />
                              </div>
                              <span className="text-sm font-medium">Paid</span>
                            </div>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setDealToMarkPaid(deal)}
                              className="text-amber-600 border-amber-300 hover:bg-amber-50"
                            >
                              <DollarSign className="h-4 w-4 mr-1" />
                              Mark Paid
                            </Button>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setDealToView(deal)
                                setViewDialogOpen(true)
                              }}
                            >
                              <Eye className="h-4 w-4 mr-1" />
                              View
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => setDealToDelete(deal)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Load more indicator */}
          {hasMore && (
            <div ref={loadMoreRef} className="py-4 text-center">
              {loadingMore && <Loader2 className="h-6 w-6 animate-spin mx-auto" />}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Deal</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this deal for MID <strong>{dealToDelete?.mid}</strong>? This will also
              delete all associated payouts and reset the linked events to unassigned. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Delete Deal
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={markPaidDialogOpen} onOpenChange={setMarkPaidDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark Deal as Paid</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to mark this deal as paid?
              <br />
              <strong>MID:</strong> {dealToMarkPaid?.mid}
              {dealToMarkPaid?.merchant_name && (
                <>
                  <br />
                  <strong>Merchant:</strong> {dealToMarkPaid.merchant_name}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={markingPaid}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleMarkAsPaid} disabled={markingPaid}>
              {markingPaid ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Confirm Mark as Paid
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* View Deal Details Dialog with tabs */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent style={{ width: "900px", maxWidth: "95vw" }} className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>View Deal Details</DialogTitle>
            <DialogDescription>View deal details and participant information</DialogDescription>
          </DialogHeader>

          {dealToView && (
            <Tabs defaultValue="basic-info" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="basic-info">Basic Info</TabsTrigger>
                <TabsTrigger value="participants">Participants</TabsTrigger>
              </TabsList>

              <TabsContent value="basic-info" className="space-y-4 mt-4">
                {/* Deal Information Card */}
                <div className="border rounded-lg p-6 space-y-6">
                  <div>
                    <h3 className="text-lg font-semibold">Deal Information</h3>
                    <p className="text-sm text-muted-foreground">Basic deal details and merchant information</p>
                  </div>

                  {/* Merchant Section */}
                  <div className="space-y-1">
                    <Label className="text-sm text-muted-foreground">Merchant</Label>
                    <div className="p-3 bg-muted/50 rounded-lg">
                      <p className="font-semibold">{dealToView.merchant_name || "Unknown Merchant"}</p>
                      <p className="text-sm text-muted-foreground">MID: {dealToView.mid}</p>
                    </div>
                  </div>

                  {/* Plan Type & Payout Month */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label className="text-sm text-muted-foreground">Plan Type</Label>
                      <div className="p-3 bg-muted/50 rounded-lg">
                        <Badge variant="outline" className="uppercase">
                          {dealToView.payout_type}
                        </Badge>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-sm text-muted-foreground">Payout Month</Label>
                      <div className="p-3 bg-muted/50 rounded-lg">
                        <p className="font-semibold">{getPayoutMonth(dealToView.effective_date)}</p>
                        <p className="text-xs text-muted-foreground">The month this deal&apos;s payout is processed</p>
                      </div>
                    </div>
                  </div>

                  {/* Deal ID & Created */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label className="text-sm text-muted-foreground">Deal ID</Label>
                      <p className="font-mono text-sm">{dealToView.deal_id || `deal_${dealToView.id.slice(0, 8)}`}</p>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-sm text-muted-foreground">Created</Label>
                      <p className="font-semibold">{formatDate(dealToView.created_at)}</p>
                    </div>
                  </div>

                  {/* Available to Purchase Checkbox */}
                  <div className="flex items-center gap-3 pt-2 border-t">
                    <Checkbox
                      id="view-available-to-purchase"
                      checked={dealToView.available_to_purchase || false}
                      onCheckedChange={handleViewToggleAvailable}
                    />
                    <Label htmlFor="view-available-to-purchase" className="text-sm font-medium cursor-pointer">
                      Available to purchase
                    </Label>
                  </div>

                  {/* Additional Details Collapsible */}
                  <Collapsible open={additionalDetailsOpen} onOpenChange={setAdditionalDetailsOpen}>
                    <CollapsibleTrigger className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
                      <ChevronDown
                        className={`h-4 w-4 transition-transform ${additionalDetailsOpen ? "rotate-180" : ""}`}
                      />
                      Additional Details
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-3 pl-5 space-y-3 border-l-2 border-muted">
                      <div className="space-y-1">
                        <Label className="text-sm text-muted-foreground">Created At</Label>
                        <p className="text-sm">{formatDateTime(dealToView.created_at)}</p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-sm text-muted-foreground">Last Updated</Label>
                        <p className="text-sm">{formatDateTime(dealToView.updated_at)}</p>
                      </div>
                      {dealToView.is_legacy_import && (
                        <div className="space-y-1">
                          <Badge variant="secondary">Legacy Import</Badge>
                        </div>
                      )}
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              </TabsContent>

              <TabsContent value="participants" className="space-y-4 mt-4">
                {/* Revenue Participants Card */}
                <div className="border rounded-lg p-6 space-y-6">
                  <div>
                    <h3 className="text-lg font-semibold">Revenue Participants</h3>
                    <p className="text-sm text-muted-foreground">
                      Manage partners and their revenue sharing percentages
                    </p>
                  </div>

                  {/* Participant Cards */}
                  <div className="space-y-4">
                    {dealToView.participants_json && dealToView.participants_json.length > 0 ? (
                      dealToView.participants_json.map((participant, index) => (
                        <div
                          key={index}
                          className={`border-2 rounded-lg p-4 ${
                            participant.partner_role === "Company" ? "border-primary/30 bg-primary/5" : "border-muted"
                          }`}
                        >
                          <div className="grid grid-cols-3 gap-4">
                            <div className="space-y-1">
                              <Label className="text-sm text-muted-foreground">Participant</Label>
                              <div className="p-2 bg-background rounded border">
                                <p className="font-medium">{participant.partner_name || "Unknown"}</p>
                                {participant.partner_airtable_id && (
                                  <p className="text-xs text-muted-foreground truncate">
                                    ({participant.partner_airtable_id.slice(0, 10)}...)
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-sm text-muted-foreground">Role</Label>
                              <div className="p-2 bg-background rounded border">
                                <Badge variant={participant.partner_role === "Company" ? "default" : "secondary"}>
                                  {participant.partner_role}
                                </Badge>
                              </div>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-sm text-muted-foreground">Split %</Label>
                              <div className="p-2 bg-background rounded border">
                                <p className="font-semibold">{participant.split_pct}%</p>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p>No participants assigned</p>
                      </div>
                    )}
                  </div>

                  {/* Split Percentage Validation */}
                  {dealToView.participants_json && dealToView.participants_json.length > 0 && (
                    <div className="flex items-center justify-between pt-4 border-t">
                      <span className="text-sm text-muted-foreground">Split Percentage Validation:</span>
                      {getTotalSplit(dealToView.participants_json) === 100 ? (
                        <Badge className="bg-primary text-primary-foreground">Valid (100%)</Badge>
                      ) : (
                        <Badge variant="destructive">Invalid ({getTotalSplit(dealToView.participants_json)}%)</Badge>
                      )}
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setViewDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
