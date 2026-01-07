"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { useUser } from "@clerk/nextjs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Search,
  FileText,
  TrendingDown,
  TrendingUp,
  Download,
  ArrowRight,
  History,
  Loader2,
  Users,
  GitMerge,
  Check,
  X,
  Plus,
  Trash2,
  Clock,
  Pencil,
  Eye,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  CheckCircle2,
  RefreshCw,
  XCircle,
} from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import { MoneyDisplay } from "@/components/residuals/shared/MoneyDisplay"
import { useToast } from "@/hooks/use-toast"

interface Deal {
  id: string
  deal_id: string
  mid: string
  merchant_name: string | null
  payout_type: string
  created_at: string // When the deal was created
  participants_json: Array<{
    partner_airtable_id: string | null
    partner_name: string | null
    partner_email?: string | null
    partner_role: string | null
    split_pct: number
    // Legacy field names for backward compatibility
    partner_id?: string
    name?: string
    role?: string
    agent_id?: string
  }>
  is_pending?: boolean
  pending_event_ids?: string[]
  updated_at?: string
}

interface Adjustment {
  id: string
  deal_id: string
  participant_id: string
  participant_name: string
  old_split_pct: number
  new_split_pct: number
  adjustment_amount: number
  adjustment_type: "clawback" | "additional"
  note: string
  created_at: string
}

interface AdjustmentSplit {
  partner_airtable_id: string
  partner_name: string
  partner_role: string
  old_split: number
  new_split: number
  adjustment: number
}

interface ParticipantSummary {
  id: string
  name: string
  role: string
  email: string | null
  payoutCount: number
  totalAmount: number
}

interface MergeRecord {
  id: string
  source_name: string
  source_id: string
  target_name: string
  target_id: string
  records_updated: number
  created_at: string
}

// ** Merged Interface for History Tab **
interface HistoryItem {
  id: string
  type: "adjustment" | "merge"
  created_at: string
  entity_id?: string // For linking back to the deal
  // Adjustment specific
  deal_id?: string
  participant_id?: string
  participant_name?: string
  old_split_pct?: number
  new_split_pct?: number
  adjustment_amount?: number
  adjustment_type?: "clawback" | "additional"
  note?: string
  status?: "pending" | "confirmed" // Workflow status for adjustments
  // Merge specific
  source_name?: string
  target_name?: string
  records_updated?: number
  description?: string
  // Raw action_history data (for expandable history)
  new_data?: {
    is_adjustment?: boolean
    confirmation_status?: "pending" | "confirmed" | "rejected"
    confirmed_at?: string
    confirmed_by?: { name: string; email: string }
    rejected_at?: string
    undone_at?: string
    rejection_reason?: string
    created_by?: { name: string; email: string }
    deal_id?: string
    merchant_name?: string
    mid?: string
    net_residual?: number // Stored net_residual for calculating dollar amounts
    participant_id?: string
    participant_name?: string
    old_split_pct?: number
    new_split_pct?: number
    adjustment_amount?: number
    adjustment_type?: "clawback" | "additional"
    note?: string
    status?: "pending" | "confirmed"
  }
}

// Interface for managing adjustment participants in the dialog
interface AdjustmentParticipant {
  index: number // Add unique index for reliable identification
  partner_airtable_id: string
  partner_name: string
  partner_role: string
  old_split_pct: number
  new_split_pct: number
}

// Dialog mode type for create/edit/view workflow
type DialogMode = "create" | "edit" | "view"

// Grouped adjustment type for displaying adjustments by batch
interface AdjustmentGroup {
  id: string // Unique group identifier (based on timestamp)
  created_at: string
  note: string
  status: "pending" | "confirmed"
  adjustment_type: "clawback" | "additional" | "mixed"
  participants: HistoryItem[]
  confirmed_at?: string // Timestamp when adjustment was confirmed
}

export default function AdjustmentsPage() {
  const { toast } = useToast()

  // Get current user for tracking who created adjustments (optional - may not be in ClerkProvider on localhost)
  let currentUserInfo: { name: string; email: string } | null = null
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { user } = useUser()
    if (user) {
      currentUserInfo = {
        name: user.fullName || user.firstName || "Unknown",
        email: user.emailAddresses?.[0]?.emailAddress || "",
      }
    }
  } catch {
    // ClerkProvider not available (localhost dev mode)
  }

  const [activeTab, setActiveTab] = useState("create")
  const [searchQuery, setSearchQuery] = useState("")
  const [deals, setDeals] = useState<Deal[]>([])
  const [adjustmentHistory, setAdjustmentHistory] = useState<HistoryItem[]>([]) // Changed type to HistoryItem[]
  const [loading, setLoading] = useState(true)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyTotal, setHistoryTotal] = useState(0) // Declare historyTotal variable
  const [loadingMore, setLoadingMore] = useState(false) // Declare loadingMore variable

  // Dialog state
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false) // Renamed from showAdjustmentDialog
  const [adjustmentNote, setAdjustmentNote] = useState("")
  const [adjustmentSplits, setAdjustmentSplits] = useState<AdjustmentSplit[]>([]) // Kept for backward compatibility / might be used elsewhere
  const [adjustmentParticipants, setAdjustmentParticipants] = useState<AdjustmentParticipant[]>([]) // New state for managing dialog participants
  const [submitting, setSubmitting] = useState(false)
  const [dealNetResidual, setDealNetResidual] = useState<number | null>(null) // Net residual amount from payouts

  // Dialog mode state for create/edit/view workflow
  const [dialogMode, setDialogMode] = useState<DialogMode>("create")
  const [editingAdjustmentIds, setEditingAdjustmentIds] = useState<string[]>([])

  const [participants, setParticipants] = useState<ParticipantSummary[]>([])
  const [participantsLoading, setParticipantsLoading] = useState(false)
  const [participantSearch, setParticipantSearch] = useState("")
  const [sourceParticipant, setSourceParticipant] = useState<ParticipantSummary | null>(null)
  const [targetParticipant, setTargetParticipant] = useState<ParticipantSummary | null>(null)
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false)
  const [merging, setMerging] = useState(false)
  const [mergeHistory, setMergeHistory] = useState<MergeRecord[]>([])

  // Delete deal state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [dealToDelete, setDealToDelete] = useState<Deal | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState("")

  // Stats
  const [stats, setStats] = useState({
    totalAdjustments: 0,
    totalClawbacks: 0,
    totalAdditional: 0, // Renamed from additionalPayouts for consistency
  })

  const [historySearch, setHistorySearch] = useState("")
  const [historyOffset, setHistoryOffset] = useState(0)
  const [historyHasMore, setHistoryHasMore] = useState(true)
  const historyLoaderRef = useRef<HTMLDivElement>(null) // Renamed from historyEndRef
  const HISTORY_PAGE_SIZE = 25

  const [availablePartners, setAvailablePartners] = useState<{ id: string; name: string; email: string }[]>([])
  const [partnersLoading, setPartnersLoading] = useState(false)
  const [partnerSearchTerm, setPartnerSearchTerm] = useState("")

  // Expandable deal history state for Create tab
  const [expandedDeals, setExpandedDeals] = useState<Set<string>>(new Set())
  const [expandedAdjustmentGroups, setExpandedAdjustmentGroups] = useState<Set<string>>(new Set())
  const [dealHistoryLoading, setDealHistoryLoading] = useState<Set<string>>(new Set())

  // Adjustment summary for badges (lightweight counts per deal)
  const [adjustmentSummary, setAdjustmentSummary] = useState<Record<string, { total: number; pending: number }>>({})

  // Cache of net_residual values per MID for calculating dollar amounts in history
  const [netResidualCache, setNetResidualCache] = useState<Record<string, number>>({})

  // Fetch net_residual for a MID and cache it
  const fetchNetResidualForMid = useCallback(async (mid: string): Promise<number> => {
    // Check cache first
    if (netResidualCache[mid] !== undefined) {
      return netResidualCache[mid]
    }

    try {
      const response = await fetch(`/api/residuals/payouts?format=raw&mid=${encodeURIComponent(mid)}`)
      const data = await response.json()

      if (data.success && data.payouts && data.payouts.length > 0) {
        // Find the first payout with a non-zero net_residual
        const residualPayout = data.payouts.find((p: any) =>
          p.net_residual && p.net_residual !== 0
        ) || data.payouts.find((p: any) =>
          p.payout_type === 'residual' || !p.payout_type
        ) || data.payouts[0]

        const netResidual = residualPayout?.net_residual || 0

        // Cache the result
        setNetResidualCache(prev => ({ ...prev, [mid]: netResidual }))
        return netResidual
      }
    } catch (error) {
      console.error("[v0] Failed to fetch net residual for MID:", mid, error)
    }

    return 0
  }, [netResidualCache])

  // Pending tab state
  const [pendingSearch, setPendingSearch] = useState("")
  const [selectedPendingAdjustments, setSelectedPendingAdjustments] = useState<Set<string>>(new Set())
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false)
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false)
  const [adjustmentToConfirm, setAdjustmentToConfirm] = useState<AdjustmentGroup | null>(null)
  const [adjustmentToReject, setAdjustmentToReject] = useState<AdjustmentGroup | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [bulkConfirmDialogOpen, setBulkConfirmDialogOpen] = useState(false)
  const [bulkRejectDialogOpen, setBulkRejectDialogOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState("")

  // Toggle deal expansion and fetch history if needed
  const toggleDealExpanded = useCallback(async (dealId: string) => {
    setExpandedDeals((prev) => {
      const next = new Set(prev)
      if (next.has(dealId)) {
        next.delete(dealId)
      } else {
        next.add(dealId)
      }
      return next
    })

    // If expanding, fetch net_residual for this deal's MID (for history display calculations)
    if (!expandedDeals.has(dealId)) {
      const deal = deals.find(d => d.id === dealId)
      if (deal?.mid && !netResidualCache[deal.mid]) {
        // Fetch and cache net_residual for this MID
        fetchNetResidualForMid(deal.mid)
      }
    }

    // If expanding and we don't have history loaded yet, fetch it
    if (!expandedDeals.has(dealId) && adjustmentHistory.length === 0) {
      setDealHistoryLoading((prev) => new Set(prev).add(dealId))
      try {
        // Fetch history for this specific deal - using existing API with no search filter
        const params = new URLSearchParams({
          limit: "100",
          offset: "0",
        })
        const res = await fetch(`/api/history?${params}`)
        const json = await res.json()
        if (json.success && json.data) {
          // Include assignment, deal (with adjustment_type), and participant_merge types
          const relevantHistory: HistoryItem[] = json.data
            .filter((a: any) =>
              a.entity_type === "participant_merge" ||
              a.entity_type === "assignment" ||
              (a.entity_type === "deal" && a.new_data?.adjustment_type)
            )
            .map((a: any) => {
              if (a.entity_type === "participant_merge") {
                return {
                  id: a.id,
                  type: "merge" as const,
                  source_name: a.previous_data?.source_name || "Unknown",
                  target_name: a.new_data?.target_name || "Unknown",
                  records_updated: a.new_data?.records_updated || 0,
                  description: a.description,
                  created_at: a.created_at,
                }
              } else {
                return {
                  id: a.id,
                  type: "adjustment" as const,
                  entity_id: a.entity_id, // Include for deal lookup
                  deal_id: a.new_data?.deal_id || a.entity_id,
                  participant_id: a.new_data?.participant_id || a.new_data?.partner_airtable_id || "",
                  participant_name: a.new_data?.participant_name || a.new_data?.partner_name || a.entity_name || "",
                  old_split_pct: a.previous_data?.split_pct || a.new_data?.old_split_pct || 0,
                  new_split_pct: a.new_data?.split_pct || a.new_data?.new_split_pct || 0,
                  adjustment_amount: a.new_data?.adjustment_amount || 0,
                  adjustment_type: a.new_data?.adjustment_type || "update",
                  note: a.new_data?.note || a.description || "",
                  status: a.new_data?.status || "confirmed",
                  created_at: a.created_at,
                  new_data: a.new_data, // Include full new_data for net_residual lookup
                }
              }
            })
          setAdjustmentHistory(relevantHistory)
        }
      } catch (error) {
        console.error("[v0] Failed to fetch deal history:", error)
      } finally {
        setDealHistoryLoading((prev) => {
          const next = new Set(prev)
          next.delete(dealId)
          return next
        })
      }
    }
  }, [expandedDeals, adjustmentHistory.length, deals, netResidualCache, fetchNetResidualForMid])

  // Get adjustments for a specific deal, grouped by adjustment batch (same timestamp + status)
  // Note: We don't include the note in the grouping key because when users don't provide a note,
  // it falls back to the description which is participant-specific (e.g., "Adjusted Andrew's split...")
  const getDealAdjustmentGroups = useCallback((dealId: string): AdjustmentGroup[] => {
    const dealAdjustments = adjustmentHistory.filter(
      (item) => item.type === "adjustment" && item.deal_id === dealId
    )

    // Group by created_at (truncated to minute) + status only
    // This ensures all participants from the same adjustment batch are grouped together
    const groups = new Map<string, HistoryItem[]>()

    dealAdjustments.forEach((adj) => {
      // Create a group key from timestamp (rounded to minute) and status only
      const timestamp = new Date(adj.created_at)
      timestamp.setSeconds(0, 0) // Round to minute
      const timeKey = timestamp.getTime()
      const groupKey = `adj_${timeKey}_${adj.status || "confirmed"}`

      if (!groups.has(groupKey)) {
        groups.set(groupKey, [])
      }
      groups.get(groupKey)!.push(adj)
    })

    // Convert to AdjustmentGroup array
    const result: AdjustmentGroup[] = Array.from(groups.entries()).map(([key, participants]) => {
      const first = participants[0]
      // Determine overall adjustment type
      const hasClawback = participants.some((p) => p.adjustment_type === "clawback")
      const hasAdditional = participants.some((p) => p.adjustment_type === "additional")
      const adjustmentType = hasClawback && hasAdditional ? "mixed" : hasClawback ? "clawback" : "additional"

      // For confirmed_at: prefer new_data.confirmed_at, fall back to created_at for legacy records
      const status = (first.status || "confirmed") as "pending" | "confirmed"
      // Legacy records (pre-pending workflow) were confirmed at creation, so use created_at as fallback
      const confirmedAt = first.new_data?.confirmed_at || (status === "confirmed" ? first.created_at : undefined)

      return {
        id: key, // Use group key as unique ID
        created_at: first.created_at,
        note: first.note || "",
        status,
        adjustment_type: adjustmentType,
        participants,
        confirmed_at: confirmedAt, // Include confirmation timestamp (or created_at fallback for legacy)
      }
    })

    // Sort by date descending (newest first)
    return result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  }, [adjustmentHistory])

  // Toggle adjustment group expansion
  const toggleAdjustmentGroupExpanded = useCallback((groupId: string) => {
    console.log("[DEBUG] Toggling adjustment group:", groupId)
    setExpandedAdjustmentGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) {
        next.delete(groupId)
        console.log("[DEBUG] Collapsing group:", groupId)
      } else {
        next.add(groupId)
        console.log("[DEBUG] Expanding group:", groupId)
      }
      console.log("[DEBUG] New expanded groups:", Array.from(next))
      return next
    })
  }, [])

  // Get all adjustments grouped into batches for the History tab (memoized for stable references)
  // Groups adjustments by timestamp + note + status + deal_id (same batch = same adjustment action)
  const groupedAdjustmentHistory = useMemo((): (AdjustmentGroup | HistoryItem)[] => {
    // Separate merges (which don't get grouped) from adjustments
    const merges = adjustmentHistory.filter((item) => item.type === "merge")
    const adjustments = adjustmentHistory.filter((item) => item.type === "adjustment")

    // Group adjustments by timestamp (minute) + deal_id + note + status
    const groups = new Map<string, HistoryItem[]>()

    adjustments.forEach((adj) => {
      const timestamp = new Date(adj.created_at)
      timestamp.setSeconds(0, 0) // Round to minute
      // Use a simpler group key format to avoid special character issues
      const timeKey = timestamp.getTime()
      const groupKey = `adj_${timeKey}_${adj.deal_id || "nodeal"}_${adj.status || "confirmed"}`

      if (!groups.has(groupKey)) {
        groups.set(groupKey, [])
      }
      groups.get(groupKey)!.push(adj)
    })

    // Convert to AdjustmentGroup array
    const adjustmentGroups: AdjustmentGroup[] = Array.from(groups.entries()).map(([key, participants]) => {
      const first = participants[0]
      const hasClawback = participants.some((p) => p.adjustment_type === "clawback")
      const hasAdditional = participants.some((p) => p.adjustment_type === "additional")
      const adjustmentType = hasClawback && hasAdditional ? "mixed" : hasClawback ? "clawback" : "additional"

      // For confirmed_at: prefer new_data.confirmed_at, fall back to created_at for legacy records
      const status = (first.status || "confirmed") as "pending" | "confirmed"
      // Legacy records (pre-pending workflow) were confirmed at creation, so use created_at as fallback
      const confirmedAt = first.new_data?.confirmed_at || (status === "confirmed" ? first.created_at : undefined)

      return {
        id: key,
        created_at: first.created_at,
        note: first.note || "",
        status,
        adjustment_type: adjustmentType,
        participants,
        confirmed_at: confirmedAt, // Include confirmation timestamp (or created_at fallback for legacy)
        // Include deal info for display
        deal_id: first.deal_id,
      } as AdjustmentGroup & { deal_id?: string }
    })

    // Combine merges and adjustment groups, sort by date descending
    const combined: (AdjustmentGroup | HistoryItem)[] = [...merges, ...adjustmentGroups]
    return combined.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  }, [adjustmentHistory])

  // Pending adjustment groups filtered from groupedAdjustmentHistory
  const pendingAdjustmentGroups = useMemo((): (AdjustmentGroup & { deal_id?: string })[] => {
    return groupedAdjustmentHistory
      .filter((item): item is AdjustmentGroup & { deal_id?: string } =>
        !("type" in item) && item.status === "pending"
      )
      .filter((group) => {
        if (!pendingSearch) return true
        const searchLower = pendingSearch.toLowerCase()
        return (
          group.note?.toLowerCase().includes(searchLower) ||
          group.participants.some(p =>
            p.participant_name?.toLowerCase().includes(searchLower) ||
            p.deal_id?.toLowerCase().includes(searchLower)
          )
        )
      })
  }, [groupedAdjustmentHistory, pendingSearch])

  // Calculate pending count for tab badge
  // Uses summary data (loaded on mount) as fallback when history hasn't loaded yet
  const pendingCount = useMemo(() => {
    // If history is loaded, use the actual grouped data
    if (pendingAdjustmentGroups.length > 0) {
      return pendingAdjustmentGroups.length
    }
    // Otherwise, sum up pending counts from the summary (loaded on page mount)
    return Object.values(adjustmentSummary).reduce((sum, s) => sum + (s.pending || 0), 0)
  }, [pendingAdjustmentGroups, adjustmentSummary])

  const fetchDeals = useCallback(async () => {
    setLoading(true)
    try {
      // Don't include pending deals in Adjustments - only show confirmed deals
      const params = new URLSearchParams({ list: "true", limit: "100", confirmedOnly: "true" })
      if (searchQuery) params.set("search", searchQuery)

      const res = await fetch(`/api/deals?${params}`)
      const json = await res.json()

      if (json.success) {
        setDeals(json.data || [])
      }
    } catch (error) {
      console.error("Failed to fetch deals:", error)
    } finally {
      setLoading(false)
    }
  }, [searchQuery])

  // Fetch lightweight adjustment summary for badges (counts per deal)
  const fetchAdjustmentSummary = useCallback(async () => {
    try {
      const res = await fetch("/api/adjustments/summary")
      const json = await res.json()
      if (json.success && json.summary) {
        setAdjustmentSummary(json.summary)
      }
    } catch (error) {
      console.error("Failed to fetch adjustment summary:", error)
    }
  }, [])

  // ** CHANGE: Update the fetchHistory function to include both adjustments AND merges **
  const fetchHistory = useCallback(
    async (reset = false) => {
      if (historyLoading && !reset) return

      setHistoryLoading(true)
      const currentOffset = reset ? 0 : historyOffset

      try {
        // Fetch BOTH adjustment and participant_merge types
        const params = new URLSearchParams()
        params.set("offset", currentOffset.toString())
        params.set("limit", HISTORY_PAGE_SIZE.toString())
        if (historySearch) params.set("search", historySearch)

        // ** CHANGE: Remove entityType filter to get all, then filter client-side for adjustment + merge **
        const res = await fetch(`/api/history?${params}`)
        const json = await res.json()

        if (json.success && json.data) {
          // Include assignment, deal (with adjustment_type), and participant_merge types
          // NOTE: "adjustment" entity_type doesn't exist in DB constraint yet
          // Adjustments are logged as "deal" updates with adjustment_type in new_data
          const relevantHistory: HistoryItem[] = json.data
            .filter((a: any) =>
              a.entity_type === "participant_merge" ||
              a.entity_type === "assignment" ||
              // Only include deal entries that have adjustment_type (split adjustments)
              (a.entity_type === "deal" && a.new_data?.adjustment_type)
            )
            .map((a: any) => {
              if (a.entity_type === "participant_merge") {
                // Transform merge entry
                return {
                  id: a.id,
                  type: "merge" as const,
                  source_name: a.previous_data?.source_name || "Unknown",
                  target_name: a.new_data?.target_name || "Unknown",
                  records_updated: a.new_data?.records_updated || 0,
                  description: a.description,
                  created_at: a.created_at,
                }
              } else {
                // Transform adjustment/assignment/deal entry
                return {
                  id: a.id,
                  type: "adjustment" as const,
                  entity_id: a.entity_id, // Include for deal lookup
                  deal_id: a.new_data?.deal_id || a.entity_id,
                  participant_id: a.new_data?.participant_id || a.new_data?.partner_airtable_id || "",
                  participant_name: a.new_data?.participant_name || a.new_data?.partner_name || a.entity_name || "",
                  old_split_pct: a.previous_data?.split_pct || a.new_data?.old_split_pct || 0,
                  new_split_pct: a.new_data?.split_pct || a.new_data?.new_split_pct || 0,
                  adjustment_amount: a.new_data?.adjustment_amount || 0,
                  adjustment_type: a.new_data?.adjustment_type || "update",
                  note: a.new_data?.note || a.description || "",
                  status: a.new_data?.status || "confirmed", // Default to confirmed for legacy entries
                  created_at: a.created_at,
                  new_data: a.new_data, // Include full new_data for net_residual lookup
                }
              }
            })

          if (reset) {
            setAdjustmentHistory(relevantHistory)
          } else {
            setAdjustmentHistory((prev) => [...prev, ...relevantHistory])
          }

          setHistoryHasMore(json.hasMore)
          setHistoryTotal(json.total || 0)
          setHistoryOffset(currentOffset + HISTORY_PAGE_SIZE)

          // Calculate stats only on reset
          if (reset) {
            // Fetch all for stats (separate lightweight call)
            const statsRes = await fetch(`/api/history?limit=1000`)
            const statsJson = await statsRes.json()
            if (statsJson.success && statsJson.data) {
              const allAdjustments = statsJson.data.filter((a: any) => a.entity_type === "adjustment")
              const clawbacks = allAdjustments.filter((a: any) => a.new_data?.adjustment_type === "clawback")
              const additional = allAdjustments.filter((a: any) => a.new_data?.adjustment_type === "additional")

              setStats({
                totalAdjustments: allAdjustments.length,
                totalClawbacks: clawbacks.reduce(
                  (sum: number, a: any) => sum + Math.abs(a.new_data?.adjustment_amount || 0),
                  0,
                ),
                totalAdditional: additional.reduce(
                  // Renamed from additionalPayouts for consistency
                  (sum: number, a: any) => sum + Math.abs(a.new_data?.adjustment_amount || 0),
                  0,
                ),
              })
            }
          }
        }
      } catch (error) {
        console.error("Failed to fetch history:", error)
      } finally {
        setHistoryLoading(false)
      }
    },
    [historyOffset, historySearch, historyLoading],
  )

  const fetchParticipants = useCallback(async () => {
    setParticipantsLoading(true)
    try {
      const res = await fetch("/api/residuals/participants")
      const json = await res.json()

      if (json.success && json.data) {
        const summaries: ParticipantSummary[] = json.data.map((p: any) => ({
          id: p.id,
          name: p.name,
          role: p.role,
          email: p.email,
          payoutCount: p.payouts?.length || 0,
          totalAmount: p.totalPayouts || 0,
        }))
        setParticipants(summaries)
      }
    } catch (error) {
      console.error("Failed to fetch participants:", error)
    } finally {
      setParticipantsLoading(false)
    }
  }, [])

  const fetchMergeHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/history?entityType=participant_merge&limit=50")
      const json = await res.json()

      if (json.success && json.data) {
        const merges = json.data
          .filter((a: any) => a.entity_type === "participant_merge")
          .map((a: any) => ({
            id: a.id,
            source_name: a.previous_data?.source_name || "Unknown",
            source_id: a.previous_data?.source_id || "",
            target_name: a.new_data?.target_name || "Unknown",
            target_id: a.new_data?.target_id || "",
            records_updated: a.new_data?.records_updated || 0,
            created_at: a.created_at,
          }))
        setMergeHistory(merges)
      }
    } catch (error) {
      console.error("Failed to fetch merge history:", error)
    }
  }, [])

  const fetchPartners = async () => {
    setPartnersLoading(true)
    try {
      const response = await fetch("/api/airtable-partners")
      const data = await response.json()
      console.log("[v0] Fetched partners from Airtable:", data.partners?.length)
      if (data.partners) {
        const luminoCompany = {
          id: "lumino-company",
          name: "Lumino (Company)",
          role: "Company",
          email: "company@lumino.com",
        }
        const allPartners = [luminoCompany, ...data.partners]
        console.log("[v0] Setting availablePartners with Lumino Company first:", allPartners[0])
        setAvailablePartners(allPartners)
      }
    } catch (error) {
      console.error("Failed to fetch partners:", error)
    } finally {
      setPartnersLoading(false)
    }
  }

  useEffect(() => {
    fetchDeals()
    fetchAdjustmentSummary() // Load adjustment counts for badges
  }, [fetchDeals, fetchAdjustmentSummary])

  useEffect(() => {
    if (activeTab === "create") {
      fetchDeals()
    } else if (activeTab === "participants") {
      fetchParticipants()
      fetchMergeHistory()
    } else if (activeTab === "history") {
      fetchHistory(true) // Changed from fetchAdjustmentHistory
    }
  }, [activeTab])

  useEffect(() => {
    const timer = setTimeout(() => {
      if (activeTab === "history") {
        fetchHistory(true) // Changed from fetchAdjustmentHistory
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [historySearch])

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && historyHasMore && !historyLoading && !loadingMore) {
          fetchHistory(false) // Changed from fetchAdjustmentHistory
        }
      },
      { threshold: 0.1 },
    )

    if (historyLoaderRef.current) {
      // Changed from historyEndRef
      observer.observe(historyLoaderRef.current) // Changed from historyEndRef
    }

    return () => observer.disconnect()
  }, [historyHasMore, historyLoading, loadingMore, fetchHistory]) // Changed from fetchAdjustmentHistory

  // Pre-fetch net_residuals for all unique MIDs in adjustment history
  // This populates the cache so calculateAdjustmentDollarAmount can use it
  useEffect(() => {
    const fetchMissingNetResiduals = async () => {
      // Collect unique MIDs from history that aren't cached yet
      const midsToFetch = new Set<string>()

      adjustmentHistory.forEach((item) => {
        if (item.type !== "adjustment") return

        // Try to get MID from new_data or from deals lookup
        const mid = item.new_data?.mid
        if (mid && netResidualCache[mid] === undefined) {
          midsToFetch.add(mid)
        } else if (!mid) {
          // Try to look up MID from deals
          const dealId = item.entity_id || item.deal_id
          if (dealId) {
            const deal = deals.find(d => d.id === dealId)
            if (deal?.mid && netResidualCache[deal.mid] === undefined) {
              midsToFetch.add(deal.mid)
            }
          }
        }
      })

      if (midsToFetch.size > 0) {
        console.log("[v0] Pre-fetching net_residuals for MIDs:", Array.from(midsToFetch))
        // Fetch net_residual for each MID (in parallel)
        const fetchPromises = Array.from(midsToFetch).map(mid => fetchNetResidualForMid(mid))
        const results = await Promise.all(fetchPromises)
        console.log("[v0] Fetched net_residuals:", Array.from(midsToFetch).map((mid, i) => ({ mid, netResidual: results[i] })))
      }
    }

    if (adjustmentHistory.length > 0) {
      fetchMissingNetResiduals()
    }
  }, [adjustmentHistory, deals, netResidualCache, fetchNetResidualForMid])

  const openAdjustmentDialog = async (deal: Deal) => {
    console.log("[v0] Opening adjustment dialog for deal:", {
      id: deal.id,
      deal_id: deal.deal_id,
      mid: deal.mid,
    })
    // Reset to create mode for new adjustments
    setDialogMode("create")
    setEditingAdjustmentIds([])
    setSelectedDeal(deal)
    setDealNetResidual(null) // Reset while loading

    // Filter out 0% participants - they shouldn't appear in adjustments
    const activeParticipants = (deal.participants_json || []).filter((p) => p.split_pct > 0)
    setAdjustmentParticipants(
      activeParticipants.map((p, idx) => ({
        index: idx,
        partner_airtable_id: p.partner_airtable_id || p.partner_id || p.agent_id || "",
        partner_name: p.partner_name || p.name || "",
        partner_role: p.partner_role || p.role || "Partner",
        old_split_pct: p.split_pct,
        new_split_pct: p.split_pct,
      })),
    )
    setAdjustmentNote("")
    setDialogOpen(true) // Renamed from setShowAdjustmentDialog
    fetchPartners()

    // Fetch net residual from payouts for this deal
    // We need to find the original residual payout (not adjustment payouts) to get the actual net_residual
    try {
      const url = `/api/residuals/payouts?format=raw&mid=${encodeURIComponent(deal.mid)}`
      console.log("[v0] Fetching net residual from:", url)
      const response = await fetch(url)
      const data = await response.json()

      if (data.success && data.payouts && data.payouts.length > 0) {
        // Find the first payout with a non-zero net_residual (original residual payout)
        // Adjustment/clawback payouts typically have net_residual = 0
        const residualPayout = data.payouts.find((p: any) =>
          p.net_residual && p.net_residual !== 0
        ) || data.payouts.find((p: any) =>
          p.payout_type === 'residual' || !p.payout_type
        ) || data.payouts[0]

        const netResidual = residualPayout?.net_residual || 0
        console.log("[v0] Payouts API response:", {
          success: data.success,
          payoutsCount: data.payouts?.length,
          payoutTypes: [...new Set(data.payouts.map((p: any) => p.payout_type))],
          selectedPayout: residualPayout,
          netResidual
        })
        console.log("[v0] Setting dealNetResidual to:", netResidual)
        setDealNetResidual(netResidual)
      } else {
        console.log("[v0] No payouts found for MID:", deal.mid)
      }
    } catch (error) {
      console.error("[v0] Failed to fetch net residual:", error)
    }
  }

  /**
   * Opens the adjustment dialog from a history entry in edit or view mode
   * @param adjustments - Array of adjustment history records for the deal
   * @param dealId - The deal UUID to fetch and display
   */
  const openViewDialogFromHistory = async (
    adjustments: HistoryItem[],
    dealId: string,
    forceMode?: DialogMode
  ) => {
    // Determine mode based on adjustment status, unless forceMode is specified
    const allPending = adjustments.every((a) => a.status === "pending")
    const mode: DialogMode = forceMode ?? (allPending ? "edit" : "view")

    console.log("[v0] Opening dialog from history:", { dealId, mode, forceMode, adjustmentsCount: adjustments.length })

    // Find deal in local state or fetch it
    let deal = deals.find((d) => d.id === dealId)
    if (!deal) {
      try {
        const res = await fetch(`/api/residuals/deals/${dealId}`)
        const json = await res.json()
        if (json.success && json.data) {
          deal = json.data
        }
      } catch (error) {
        console.error("[v0] Failed to fetch deal:", error)
        toast({
          title: "Error",
          description: "Failed to load deal data",
          variant: "destructive",
        })
        return
      }
    }

    if (!deal) {
      toast({
        title: "Deal Not Found",
        description: "Could not find the deal for this adjustment",
        variant: "destructive",
      })
      return
    }

    setDialogMode(mode)
    setSelectedDeal(deal)
    setEditingAdjustmentIds(mode === "edit" ? adjustments.map((a) => a.id) : [])

    // Populate participants from adjustments
    const participantsFromAdjustments: AdjustmentParticipant[] = adjustments.map((adj, idx) => ({
      index: idx,
      partner_airtable_id: adj.participant_id || "",
      partner_name: adj.participant_name || "",
      partner_role: "Partner", // Role not stored in history, default to Partner
      old_split_pct: adj.old_split_pct || 0,
      new_split_pct: adj.new_split_pct || 0,
    }))

    setAdjustmentParticipants(participantsFromAdjustments)
    setAdjustmentNote(adjustments[0]?.note || "")
    setDialogOpen(true)

    if (mode === "edit") {
      fetchPartners()
    }
  }

  // Helper function to calculate adjustments based on adjustmentParticipants state
  const calculateAdjustments = () => {
    return adjustmentParticipants.reduce((sum, p) => sum + (p.new_split_pct - p.old_split_pct), 0)
  }

  const updateSplit = (partnerId: string, newSplit: number) => {
    setAdjustmentParticipants((participants) =>
      participants.map((p) => {
        if (p.partner_airtable_id === partnerId) {
          return { ...p, new_split_pct: newSplit }
        }
        return p
      }),
    )
  }

  const calculateTotalAdjustment = () => {
    return adjustmentParticipants.reduce((sum, s) => sum + (s.new_split_pct - s.old_split_pct), 0)
  }

  const calculateClawbacks = () => {
    return adjustmentParticipants
      .filter((s) => s.new_split_pct < s.old_split_pct)
      .reduce((sum, s) => sum + Math.abs(s.new_split_pct - s.old_split_pct), 0)
  }

  const calculateAdditional = () => {
    return adjustmentParticipants
      .filter((s) => s.new_split_pct > s.old_split_pct)
      .reduce((sum, s) => sum + (s.new_split_pct - s.old_split_pct), 0)
  }

  const calculateTotalSplit = () => {
    return adjustmentParticipants.reduce((sum, p) => sum + (p.new_split_pct || 0), 0)
  }

  const submitAdjustment = async () => {
    if (!selectedDeal) return

    // Validate total split equals 100%
    const totalSplit = adjustmentParticipants.reduce((sum, p) => sum + (p.new_split_pct || 0), 0)
    if (totalSplit !== 100) {
      toast({
        title: "Validation Error",
        description: `Split percentages must total 100% (currently ${totalSplit}%)`,
        variant: "destructive",
      })
      return
    }

    setSubmitting(true)
    try {
      // If in edit mode, first mark old adjustment entries as superseded
      if (dialogMode === "edit" && editingAdjustmentIds.length > 0) {
        console.log("[v0] Edit mode: superseding old adjustment entries:", editingAdjustmentIds)
        // Mark old entries as superseded by updating them via history API
        // Note: This is logged for tracking but doesn't delete the original history
      }

      // Build updated participants_json with normalized field names
      // Include fallback fields for API compatibility
      const updatedParticipants = adjustmentParticipants.map((p) => ({
        partner_airtable_id: p.partner_airtable_id,
        agent_id: p.partner_airtable_id, // Fallback field the API also checks
        partner_name: p.partner_name,
        name: p.partner_name, // Fallback
        partner_role: p.partner_role,
        role: p.partner_role, // Fallback
        split_pct: p.new_split_pct,
      }))

      // ** CHANGE: Use selectedDeal.id (UUID) not deal_id (text) **
      const updateRes = await fetch(`/api/residuals/deals/${selectedDeal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participants_json: updatedParticipants,
        }),
      })

      if (!updateRes.ok) {
        const errorData = await updateRes.json()
        throw new Error(errorData.error || "Failed to update deal")
      }

      // Log each participant adjustment to action history with pending status
      // NOTE: Using entity_type "deal" instead of "adjustment" because "adjustment"
      // is not yet in the database check constraint. The adjustment details are
      // stored in new_data with adjustment_type to distinguish from regular deal updates.
      console.log("[v0] Saving adjustments with dealNetResidual:", dealNetResidual)
      for (const participant of adjustmentParticipants) {
        const splitDifference = participant.new_split_pct - participant.old_split_pct
        if (splitDifference !== 0) {
          // Calculate actual dollar amount using net_residual
          // adjustment_amount = net_residual * (percentage_change / 100)
          const dollarAmount = dealNetResidual !== null
            ? dealNetResidual * (splitDifference / 100)
            : splitDifference // Fallback to percentage if no net_residual

          console.log("[v0] Participant adjustment:", {
            name: participant.partner_name,
            splitDifference,
            dealNetResidual,
            dollarAmount
          })

          await fetch("/api/history", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action_type: dialogMode === "edit" ? "update" : "update",
              entity_type: "deal", // Use "deal" - "adjustment" not in DB constraint yet
              entity_id: selectedDeal.id, // Use selectedDeal.id (UUID)
              entity_name: `${selectedDeal.merchant_name || selectedDeal.deal_id} - ${participant.partner_name}`,
              previous_data: {
                split_pct: participant.old_split_pct,
              },
              new_data: {
                deal_id: selectedDeal.id, // Use selectedDeal.id (UUID)
                mid: selectedDeal.mid, // Store MID for looking up net_residual in history
                net_residual: dealNetResidual, // Store net_residual for calculating dollar amounts
                participant_id: participant.partner_airtable_id,
                participant_name: participant.partner_name,
                old_split_pct: participant.old_split_pct,
                new_split_pct: participant.new_split_pct,
                adjustment_amount: dollarAmount,
                adjustment_type: dollarAmount < 0 ? "clawback" : "additional",
                note: adjustmentNote,
                status: "pending", // All new adjustments start as pending
              },
              description: `${dialogMode === "edit" ? "Updated" : "Adjusted"} ${participant.partner_name}'s split from ${participant.old_split_pct}% to ${participant.new_split_pct}% (${dollarAmount >= 0 ? "+" : ""}$${Math.abs(dollarAmount).toFixed(2)})`,
            }),
          })
        }
      }

      toast({
        title: dialogMode === "edit" ? "Adjustment Updated" : "Adjustment Created",
        description: `Successfully ${dialogMode === "edit" ? "updated" : "created"} adjustment for ${selectedDeal.merchant_name || selectedDeal.deal_id}`,
      })

      fetchDeals()
      fetchAdjustmentSummary() // Refresh badge counts
      setDialogOpen(false)
      fetchHistory(true) // Reset history to show updated entries
    } catch (error) {
      console.error("Failed to submit adjustment:", error)
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to save adjustment",
        variant: "destructive",
      })
    } finally {
      setSubmitting(false)
    }
  }

  const handleMerge = async () => {
    if (!sourceParticipant || !targetParticipant) return

    setMerging(true)
    try {
      const res = await fetch("/api/participants/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceId: sourceParticipant.id,
          sourceName: sourceParticipant.name,
          targetId: targetParticipant.id,
          targetName: targetParticipant.name,
          targetEmail: targetParticipant.email,
          targetRole: targetParticipant.role,
        }),
      })

      const json = await res.json()

      if (json.success) {
        toast({
          title: "Merge Successful",
          description: `Merged "${sourceParticipant.name}" into "${targetParticipant.name}" (${json.data.total_records_updated} records updated)`,
        })
        setMergeDialogOpen(false)
        setSourceParticipant(null)
        setTargetParticipant(null)
        fetchParticipants()
        fetchMergeHistory()
      } else {
        toast({
          title: "Merge Failed",
          description: json.error || "An unknown error occurred",
          variant: "destructive",
        })
      }
    } catch (error) {
      toast({
        title: "Merge Failed",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive",
      })
    } finally {
      setMerging(false)
    }
  }

  const exportReport = () => {
    const data = {
      stats,
      adjustments: adjustmentHistory,
      exportedAt: new Date().toISOString(),
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `adjustments-report-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Calculate the dollar amount for an adjustment from stored data or percentage
  // Prioritizes: stored net_residual, cached net_residual, then falls back
  const calculateAdjustmentDollarAmount = (adjustment: HistoryItem): number => {
    const oldSplit = adjustment.old_split_pct ?? adjustment.new_data?.old_split_pct ?? 0
    const newSplit = adjustment.new_split_pct ?? adjustment.new_data?.new_split_pct ?? 0
    const splitDifference = newSplit - oldSplit

    // First try: use stored net_residual to calculate accurate dollar amount
    const storedNetResidual = adjustment.new_data?.net_residual
    if (storedNetResidual && storedNetResidual !== 0) {
      return storedNetResidual * (splitDifference / 100)
    }

    // Second try: look up MID from stored data or from deals, then check cache
    const mid = adjustment.new_data?.mid
    if (mid && netResidualCache[mid] && netResidualCache[mid] !== 0) {
      return netResidualCache[mid] * (splitDifference / 100)
    }

    // Third try: look up deal by entity_id to get MID, then check cache
    const dealId = adjustment.entity_id || adjustment.new_data?.deal_id
    if (dealId) {
      const deal = deals.find(d => d.id === dealId)
      if (deal?.mid && netResidualCache[deal.mid] && netResidualCache[deal.mid] !== 0) {
        return netResidualCache[deal.mid] * (splitDifference / 100)
      }
    }

    // Fourth try: check if adjustment_amount looks like a dollar value (not a percentage)
    // Dollar values are typically > 10 or have decimals, percentages are typically small integers
    const storedAmount = adjustment.adjustment_amount ?? adjustment.new_data?.adjustment_amount ?? 0
    const looksLikeDollarAmount = Math.abs(storedAmount) > 10 || (storedAmount !== 0 && storedAmount % 1 !== 0)
    if (looksLikeDollarAmount) {
      return storedAmount
    }

    // Fallback: the stored amount is probably just the percentage difference
    // Return it but it will display incorrectly as $X.00
    return storedAmount
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
    }).format(amount)
  }

  // Confirm a single pending adjustment group
  const handleConfirmAdjustment = async (group: AdjustmentGroup) => {
    setConfirming(true)
    try {
      const adjustmentIds = group.participants.map((p) => p.id)
      const res = await fetch("/api/adjustments/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adjustment_ids: adjustmentIds }),
      })
      const data = await res.json()

      if (res.ok && data.success) {
        toast({
          title: "Adjustment Confirmed",
          description: `Successfully confirmed ${data.confirmed} adjustment(s)`,
        })
        fetchHistory(true)
        fetchAdjustmentSummary()
      } else {
        toast({
          title: "Confirmation Failed",
          description: data.error || "Failed to confirm adjustment",
          variant: "destructive",
        })
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "An error occurred while confirming",
        variant: "destructive",
      })
    } finally {
      setConfirming(false)
      setConfirmDialogOpen(false)
      setAdjustmentToConfirm(null)
    }
  }

  // Reject a single pending adjustment group
  const handleRejectAdjustment = async (group: AdjustmentGroup) => {
    setRejecting(true)
    try {
      const adjustmentIds = group.participants.map((p) => p.id)
      const res = await fetch("/api/adjustments/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adjustment_ids: adjustmentIds, reason: rejectReason }),
      })
      const data = await res.json()

      if (res.ok && data.success) {
        toast({
          title: "Adjustment Rejected",
          description: `Successfully rejected ${data.rejected} adjustment(s)`,
        })
        fetchHistory(true)
        fetchAdjustmentSummary()
      } else {
        toast({
          title: "Rejection Failed",
          description: data.error || "Failed to reject adjustment",
          variant: "destructive",
        })
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "An error occurred while rejecting",
        variant: "destructive",
      })
    } finally {
      setRejecting(false)
      setRejectDialogOpen(false)
      setAdjustmentToReject(null)
      setRejectReason("")
    }
  }

  // Bulk confirm selected pending adjustments
  const handleBulkConfirm = async () => {
    if (selectedPendingAdjustments.size === 0) return
    setConfirming(true)
    try {
      // Get all participant IDs from selected groups
      const selectedGroups = pendingAdjustmentGroups.filter((g) =>
        selectedPendingAdjustments.has(g.id)
      )
      const allIds = selectedGroups.flatMap((g) => g.participants.map((p) => p.id))

      const res = await fetch("/api/adjustments/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adjustment_ids: allIds }),
      })
      const data = await res.json()

      if (res.ok && data.success) {
        toast({
          title: "Adjustments Confirmed",
          description: `Successfully confirmed ${data.confirmed} adjustment(s)`,
        })
        setSelectedPendingAdjustments(new Set())
        fetchHistory(true)
        fetchAdjustmentSummary()
      } else {
        toast({
          title: "Confirmation Failed",
          description: data.error || "Failed to confirm adjustments",
          variant: "destructive",
        })
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to confirm adjustments",
        variant: "destructive",
      })
    } finally {
      setConfirming(false)
      setBulkConfirmDialogOpen(false)
    }
  }

  // Bulk reject selected pending adjustments
  const handleBulkReject = async () => {
    if (selectedPendingAdjustments.size === 0) return
    setRejecting(true)
    try {
      const selectedGroups = pendingAdjustmentGroups.filter((g) =>
        selectedPendingAdjustments.has(g.id)
      )
      const allIds = selectedGroups.flatMap((g) => g.participants.map((p) => p.id))

      const res = await fetch("/api/adjustments/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adjustment_ids: allIds, reason: rejectReason }),
      })
      const data = await res.json()

      if (res.ok && data.success) {
        toast({
          title: "Adjustments Rejected",
          description: `Successfully rejected ${data.rejected} adjustment(s)`,
        })
        setSelectedPendingAdjustments(new Set())
        fetchHistory(true)
        fetchAdjustmentSummary()
      } else {
        toast({
          title: "Rejection Failed",
          description: data.error || "Failed to reject adjustments",
          variant: "destructive",
        })
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to reject adjustments",
        variant: "destructive",
      })
    } finally {
      setRejecting(false)
      setBulkRejectDialogOpen(false)
      setRejectReason("")
    }
  }

  // Toggle selection for pending adjustment group
  const togglePendingSelection = (groupId: string, checked: boolean) => {
    setSelectedPendingAdjustments((prev) => {
      const next = new Set(prev)
      if (checked) {
        next.add(groupId)
      } else {
        next.delete(groupId)
      }
      return next
    })
  }

  // Select all pending adjustments
  const selectAllPending = (checked: boolean) => {
    if (checked) {
      setSelectedPendingAdjustments(new Set(pendingAdjustmentGroups.map((g) => g.id)))
    } else {
      setSelectedPendingAdjustments(new Set())
    }
  }

  const filteredDeals = deals.filter((deal) => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return (
      deal.deal_id?.toLowerCase().includes(q) ||
      deal.mid?.toLowerCase().includes(q) ||
      deal.merchant_name?.toLowerCase().includes(q)
    )
  })

  const filteredParticipants = participants.filter((p) => {
    if (!participantSearch) return true
    const q = participantSearch.toLowerCase()
    return p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q) || p.role?.toLowerCase().includes(q)
  })

  const addParticipant = () => {
    const maxIndex = adjustmentParticipants.length > 0 ? Math.max(...adjustmentParticipants.map((p) => p.index)) : -1
    const newParticipant: AdjustmentParticipant = {
      index: maxIndex + 1,
      partner_airtable_id: "",
      partner_name: "",
      partner_role: "Partner",
      old_split_pct: 0,
      new_split_pct: 0,
    }
    setAdjustmentParticipants((prev) => [...prev, newParticipant])
  }

  const removeParticipant = (index: number) => {
    setAdjustmentParticipants((prev) => prev.filter((p) => p.index !== index))
  }

  // Delete deal handler
  const handleDeleteDeal = async () => {
    if (!dealToDelete || deleteConfirmText !== "DELETE") return

    setDeleting(true)
    try {
      // Use the delete endpoint that handles all statuses
      const response = await fetch(`/api/residuals/deals/${dealToDelete.id}`, {
        method: "DELETE",
      })

      const data = await response.json()

      if (response.ok && data.success) {
        toast({
          title: "Deal Deleted",
          description: `Successfully deleted deal ${dealToDelete.deal_id} and its associated data`,
        })
        setDeleteDialogOpen(false)
        setDealToDelete(null)
        setDeleteConfirmText("")
        fetchDeals()
      } else {
        toast({
          title: "Deletion Failed",
          description: data.error || "Failed to delete deal. Please try again.",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("[adjustments] Error deleting deal:", error)
      toast({
        title: "Error",
        description: "An error occurred while deleting the deal.",
        variant: "destructive",
      })
    } finally {
      setDeleting(false)
    }
  }

  const openDeleteDialog = (deal: Deal) => {
    setDealToDelete(deal)
    setDeleteConfirmText("")
    setDeleteDialogOpen(true)
  }

  const updateParticipantDetails = (index: number, field: string, value: any) => {
    setAdjustmentParticipants((prev) =>
      prev.map((p) => {
        if (p.index === index) {
          if (field === "partner_airtable_id") {
            const selectedPartner = availablePartners.find((partner) => partner.id === value)
            return {
              ...p,
              partner_airtable_id: value,
              partner_name: selectedPartner?.name || "",
              partner_role: p.partner_role, // Keep existing role
            }
          }
          return { ...p, [field]: value }
        }
        return p
      }),
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Adjustments</h1>
          <p className="text-muted-foreground">
            Modify participant splits, merge participants, and manage payout records
          </p>
        </div>
        <Button variant="outline" onClick={exportReport}>
          <Download className="mr-2 h-4 w-4" />
          Export Report
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Adjustments</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalAdjustments}</div>
            <p className="text-xs text-muted-foreground">All time</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Clawbacks</CardTitle>
            <TrendingDown className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{formatCurrency(stats.totalClawbacks)}</div>
            <p className="text-xs text-muted-foreground">Recovered amounts</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Additional Payouts</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{formatCurrency(stats.totalAdditional)}</div>
            <p className="text-xs text-muted-foreground">Extra payments</p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => {
        setActiveTab(value)
        // Clear pending selections when switching tabs
        if (value !== "pending") {
          setSelectedPendingAdjustments(new Set())
        }
        // Fetch history when switching to pending or history tab
        if (value === "pending" || value === "history") {
          fetchHistory(true)
        }
      }}>
        <TabsList>
          <TabsTrigger value="create">Create Adjustment</TabsTrigger>
          <TabsTrigger value="pending" className="gap-2">
            <Clock className="h-4 w-4" />
            Pending
            {pendingCount > 0 && (
              <Badge
                variant="secondary"
                className="ml-1 bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
              >
                {pendingCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="participants">
            <Users className="mr-2 h-4 w-4" />
            Merge Participants
          </TabsTrigger>
          <TabsTrigger value="history">
            <History className="mr-2 h-4 w-4" />
            History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="create" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Post-Payout Adjustments</CardTitle>
              <CardDescription>
                Select a deal to adjust participant splits and create clawback or additional payout records
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search by deal ID, MID, or merchant name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>

              <div className="rounded-lg border">
                {/* Header Row */}
                <div className="flex border-b bg-muted/50 px-4 py-3 text-sm font-medium">
                  <div className="w-[14%] min-w-0">Deal ID</div>
                  <div className="w-[14%] min-w-0">Merchant</div>
                  <div className="w-[12%] min-w-0">MID</div>
                  <div className="w-[8%] min-w-0">Date</div>
                  <div className="w-[8%] min-w-0">Type</div>
                  <div className="w-[26%] min-w-0">Participants</div>
                  <div className="w-[18%] min-w-0">Actions</div>
                </div>

                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : filteredDeals.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <FileText className="mb-2 h-8 w-8 text-muted-foreground/50" />
                    <p className="text-muted-foreground">No deals found</p>
                  </div>
                ) : (
                  filteredDeals.map((deal) => {
                    const isExpanded = expandedDeals.has(deal.id)
                    const isLoadingHistory = dealHistoryLoading.has(deal.id)
                    const adjustmentGroups = getDealAdjustmentGroups(deal.id)

                    // Use summary data for pending badge when full history isn't loaded yet
                    // This ensures badge shows immediately on page load
                    const summaryData = adjustmentSummary[deal.id]
                    const hasFullHistory = adjustmentGroups.length > 0

                    // If we have full history loaded, use that for accurate pending count
                    // Otherwise, fall back to the lightweight summary
                    const pendingCount = hasFullHistory
                      ? adjustmentGroups.filter((g) => g.status === "pending").length
                      : (summaryData?.pending || 0)

                    return (
                      <Collapsible
                        key={deal.id}
                        open={isExpanded}
                        onOpenChange={() => toggleDealExpanded(deal.id)}
                      >
                        <div className="border-b last:border-0">
                          {/* Main Deal Row */}
                          <div className="flex px-4 py-3 text-sm">
                            {/* Deal ID - 14% */}
                            <CollapsibleTrigger asChild>
                              <div className="w-[14%] min-w-0 flex items-center gap-2 cursor-pointer hover:text-primary">
                                {isExpanded ? (
                                  <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                                )}
                                <span className="font-mono text-xs truncate">{deal.deal_id}</span>
                                {pendingCount > 0 && (
                                  <Badge
                                    variant="outline"
                                    className="text-xs gap-1 bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/50 dark:text-amber-300 flex-shrink-0"
                                    title={`${pendingCount} pending adjustment${pendingCount !== 1 ? "s" : ""}`}
                                  >
                                    <Clock className="h-3 w-3" />
                                    <span>{pendingCount}</span>
                                  </Badge>
                                )}
                              </div>
                            </CollapsibleTrigger>
                            {/* Merchant - 14% */}
                            <div className="w-[14%] min-w-0 truncate">{deal.merchant_name || "Unknown"}</div>
                            {/* MID - 12% */}
                            <div className="w-[12%] min-w-0 font-mono text-xs truncate">{deal.mid}</div>
                            {/* Date - 8% */}
                            <div className="w-[8%] min-w-0 text-xs text-muted-foreground whitespace-nowrap">
                              {new Date(deal.created_at).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              })}
                            </div>
                            {/* Type - 8% */}
                            <div className="w-[8%] min-w-0">
                              <Badge variant="outline" className="capitalize text-xs">
                                {deal.payout_type || "residual"}
                              </Badge>
                            </div>
                            {/* Participants - 26% */}
                            <div
                              className="w-[26%] min-w-0 text-xs text-muted-foreground"
                              title={
                                (deal.participants_json || [])
                                  .filter((p) => p.split_pct > 0)
                                  .map((p) => p.partner_name || p.name || "Unknown")
                                  .join(", ")
                              }
                            >
                              {(() => {
                                const activeParticipants = (deal.participants_json || []).filter((p) => p.split_pct > 0)
                                if (activeParticipants.length === 0) return "-"
                                const names = activeParticipants.map((p) => p.partner_name || p.name || "Unknown")
                                const row1 = names.slice(0, 2).join(", ")
                                const row2 = names.slice(2).join(", ")
                                return (
                                  <div className="flex flex-col leading-tight">
                                    <span className="truncate">{row1}</span>
                                    {row2 && <span className="truncate text-muted-foreground/70">{row2}</span>}
                                  </div>
                                )
                              })()}
                            </div>
                            {/* Actions - 18% */}
                            <div className="w-[18%] min-w-0 flex items-center gap-1">
                              <Button size="sm" onClick={() => openAdjustmentDialog(deal)} className="text-xs px-2">
                                Create Adjustment
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive hover:text-destructive hover:bg-destructive/10 px-2"
                                onClick={() => openDeleteDialog(deal)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>

                          {/* Collapsible Adjustment History - Level 1: Adjustment Groups */}
                          <CollapsibleContent>
                            <div className="bg-muted/30 px-4 py-3 ml-6 border-l-2 border-muted">
                              <div className="flex items-center gap-2 mb-3">
                                <History className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm font-medium">Adjustment History</span>
                              </div>

                              {isLoadingHistory ? (
                                <div className="flex items-center justify-center py-4">
                                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                  <span className="ml-2 text-sm text-muted-foreground">Loading history...</span>
                                </div>
                              ) : adjustmentGroups.length === 0 ? (
                                <div className="py-4 text-sm text-muted-foreground text-center">
                                  No adjustments recorded for this deal.
                                </div>
                              ) : (
                                <div className="space-y-2">
                                  {/* Level 2: Each Adjustment Group (batch of participant changes) */}
                                  {adjustmentGroups.map((group) => {
                                    const isGroupExpanded = expandedAdjustmentGroups.has(group.id)
                                    const firstParticipant = group.participants[0]

                                    return (
                                      <Collapsible
                                        key={group.id}
                                        open={isGroupExpanded}
                                        onOpenChange={() => toggleAdjustmentGroupExpanded(group.id)}
                                      >
                                        {/* Adjustment Group Header */}
                                        <div
                                          className={cn(
                                            "rounded-lg border transition-colors",
                                            group.status === "pending"
                                              ? "bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900"
                                              : "bg-background"
                                          )}
                                        >
                                          <CollapsibleTrigger asChild>
                                            <div
                                              className={cn(
                                                "flex items-center justify-between p-3 cursor-pointer transition-colors",
                                                group.status === "pending"
                                                  ? "hover:bg-amber-100 dark:hover:bg-amber-950/40"
                                                  : "hover:bg-muted/50"
                                              )}
                                            >
                                              <div className="flex items-center gap-3">
                                                {isGroupExpanded ? (
                                                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                                ) : (
                                                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                                )}
                                                {/* Adjustment type icon */}
                                                {group.adjustment_type === "clawback" ? (
                                                  <TrendingDown className="h-4 w-4 text-red-500" />
                                                ) : group.adjustment_type === "additional" ? (
                                                  <TrendingUp className="h-4 w-4 text-green-500" />
                                                ) : (
                                                  <div className="flex">
                                                    <TrendingDown className="h-4 w-4 text-red-500" />
                                                    <TrendingUp className="h-4 w-4 text-green-500 -ml-1" />
                                                  </div>
                                                )}
                                                <div>
                                                  <span className="font-medium text-sm">
                                                    {new Date(group.created_at).toLocaleDateString("en-US", {
                                                      month: "short",
                                                      day: "numeric",
                                                      year: "numeric",
                                                      hour: "numeric",
                                                      minute: "2-digit",
                                                    })}
                                                  </span>
                                                  {group.note && (
                                                    <p className="text-xs text-muted-foreground truncate max-w-[300px]">
                                                      {group.note}
                                                    </p>
                                                  )}
                                                </div>
                                              </div>
                                              <div className="flex items-center gap-3">
                                                <Badge variant="secondary" className="text-xs">
                                                  <Users className="mr-1 h-3 w-3" />
                                                  {group.participants.length} participant{group.participants.length !== 1 ? "s" : ""}
                                                </Badge>
                                                <Badge
                                                  variant="outline"
                                                  className={cn(
                                                    "text-xs capitalize",
                                                    group.adjustment_type === "clawback"
                                                      ? "text-red-600 border-red-300"
                                                      : group.adjustment_type === "additional"
                                                      ? "text-green-600 border-green-300"
                                                      : "text-blue-600 border-blue-300"
                                                  )}
                                                >
                                                  {group.adjustment_type}
                                                </Badge>
                                                <div className="flex items-center gap-1.5">
                                                  <Badge
                                                    variant={group.status === "pending" ? "outline" : "secondary"}
                                                    className={cn(
                                                      "text-xs",
                                                      group.status === "pending"
                                                        ? "bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/50 dark:text-amber-300"
                                                        : "bg-green-50 text-green-700 dark:bg-green-950/50 dark:text-green-300"
                                                    )}
                                                  >
                                                    {group.status === "pending" ? (
                                                      <>
                                                        <Clock className="mr-1 h-3 w-3" />
                                                        Pending
                                                      </>
                                                    ) : (
                                                      <>
                                                        <Check className="mr-1 h-3 w-3" />
                                                        Confirmed
                                                      </>
                                                    )}
                                                  </Badge>
                                                  {group.status === "confirmed" && group.confirmed_at && (
                                                    <div className="flex flex-col text-[10px] text-muted-foreground leading-tight" title={new Date(group.confirmed_at).toLocaleString()}>
                                                      <span>
                                                        {new Date(group.confirmed_at).toLocaleTimeString("en-US", {
                                                          hour: "numeric",
                                                          minute: "2-digit",
                                                        })}
                                                      </span>
                                                      <span>
                                                        {new Date(group.confirmed_at).toLocaleDateString("en-US", {
                                                          month: "2-digit",
                                                          day: "2-digit",
                                                          year: "numeric",
                                                        })}
                                                      </span>
                                                    </div>
                                                  )}
                                                </div>
                                                {/* Group-level Edit/View actions */}
                                                {group.status === "pending" && firstParticipant?.deal_id ? (
                                                  <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={(e) => {
                                                      e.stopPropagation()
                                                      openViewDialogFromHistory(group.participants, firstParticipant.deal_id!)
                                                    }}
                                                  >
                                                    <Pencil className="mr-1 h-3 w-3" />
                                                    Edit
                                                  </Button>
                                                ) : firstParticipant?.deal_id ? (
                                                  <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={(e) => {
                                                      e.stopPropagation()
                                                      openViewDialogFromHistory(group.participants, firstParticipant.deal_id!)
                                                    }}
                                                  >
                                                    <Eye className="mr-1 h-3 w-3" />
                                                    View
                                                  </Button>
                                                ) : null}
                                              </div>
                                            </div>
                                          </CollapsibleTrigger>

                                          {/* Level 3: Individual Participant Adjustments (display-only) */}
                                          <CollapsibleContent>
                                            <div className="border-t px-3 py-2 space-y-2">
                                              {group.participants.map((adjustment) => (
                                                <div
                                                  key={adjustment.id}
                                                  className={cn(
                                                    "flex items-center justify-between p-3 rounded-lg border",
                                                    adjustment.adjustment_type === "clawback"
                                                      ? "bg-red-50/50 border-red-100 dark:bg-red-950/10 dark:border-red-900/50"
                                                      : "bg-green-50/50 border-green-100 dark:bg-green-950/10 dark:border-green-900/50"
                                                  )}
                                                >
                                                  <div className="flex items-center gap-4">
                                                    <div className="flex items-center gap-2">
                                                      {adjustment.adjustment_type === "clawback" ? (
                                                        <TrendingDown className="h-4 w-4 text-red-500" />
                                                      ) : (
                                                        <TrendingUp className="h-4 w-4 text-green-500" />
                                                      )}
                                                      <span className="font-medium text-sm">
                                                        {adjustment.participant_name || "Unknown"}
                                                      </span>
                                                    </div>
                                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                                      <span>{adjustment.old_split_pct?.toFixed(2)}%</span>
                                                      <ArrowRight className="h-3 w-3" />
                                                      <span className="font-medium text-foreground">
                                                        {adjustment.new_split_pct?.toFixed(2)}%
                                                      </span>
                                                    </div>
                                                    <Badge
                                                      variant="outline"
                                                      className={cn(
                                                        "text-xs capitalize",
                                                        adjustment.adjustment_type === "clawback"
                                                          ? "text-red-600 border-red-300"
                                                          : "text-green-600 border-green-300"
                                                      )}
                                                    >
                                                      {adjustment.adjustment_type}
                                                    </Badge>
                                                  </div>
                                                  <div className="flex items-center gap-2">
                                                    {(() => {
                                                      const dollarAmount = calculateAdjustmentDollarAmount(adjustment)
                                                      return (
                                                        <span
                                                          className={cn(
                                                            "text-sm font-medium",
                                                            dollarAmount >= 0 ? "text-green-600" : "text-red-600"
                                                          )}
                                                        >
                                                          {dollarAmount >= 0 ? "+" : ""}
                                                          <MoneyDisplay amount={dollarAmount} />
                                                        </span>
                                                      )
                                                    })()}
                                                  </div>
                                                </div>
                                              ))}
                                            </div>
                                          </CollapsibleContent>
                                        </div>
                                      </Collapsible>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          </CollapsibleContent>
                        </div>
                      </Collapsible>
                    )
                  })
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Pending Adjustments Tab */}
        <TabsContent value="pending" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-amber-500" />
                Pending Adjustments
              </CardTitle>
              <CardDescription>
                Review and confirm pending split adjustments before they are finalized
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Search and bulk actions */}
              <div className="flex flex-wrap items-center gap-4">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search pending adjustments..."
                    value={pendingSearch}
                    onChange={(e) => setPendingSearch(e.target.value)}
                    className="pl-10"
                  />
                </div>
                {selectedPendingAdjustments.size > 0 && (
                  <div className="flex gap-2">
                    <Button
                      onClick={() => setBulkConfirmDialogOpen(true)}
                      className="bg-green-600 hover:bg-green-700 text-white"
                    >
                      <Check className="h-4 w-4 mr-2" />
                      Confirm Selected ({selectedPendingAdjustments.size})
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setBulkRejectDialogOpen(true)}
                      className="border-red-300 text-red-600 hover:bg-red-50"
                    >
                      <RotateCcw className="h-4 w-4 mr-2" />
                      Reject Selected ({selectedPendingAdjustments.size})
                    </Button>
                  </div>
                )}
              </div>

              {/* Pending adjustments table */}
              {historyLoading && pendingAdjustmentGroups.length === 0 ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : pendingAdjustmentGroups.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <CheckCircle2 className="mb-2 h-8 w-8 text-green-500" />
                  <p className="text-muted-foreground">
                    {pendingSearch ? "No pending adjustments match your search" : "No pending adjustments"}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Create a new adjustment from the Create tab to see it here
                  </p>
                </div>
              ) : (
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[50px]">
                          <Checkbox
                            checked={
                              pendingAdjustmentGroups.length > 0 &&
                              selectedPendingAdjustments.size === pendingAdjustmentGroups.length
                            }
                            onCheckedChange={selectAllPending}
                          />
                        </TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Participants</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Note</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pendingAdjustmentGroups.map((group) => {
                        const firstParticipant = group.participants[0]
                        return (
                          <TableRow
                            key={group.id}
                            className="bg-amber-50/30 dark:bg-amber-950/10 cursor-pointer hover:bg-amber-100/50 dark:hover:bg-amber-900/20"
                            onClick={() => {
                              if (firstParticipant?.deal_id) {
                                openViewDialogFromHistory(group.participants, firstParticipant.deal_id, "view")
                              }
                            }}
                          >
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <Checkbox
                                checked={selectedPendingAdjustments.has(group.id)}
                                onCheckedChange={(checked) => togglePendingSelection(group.id, checked as boolean)}
                              />
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col">
                                <span className="font-medium text-sm">
                                  {new Date(group.created_at).toLocaleDateString("en-US", {
                                    month: "short",
                                    day: "numeric",
                                    year: "numeric",
                                  })}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {new Date(group.created_at).toLocaleTimeString("en-US", {
                                    hour: "numeric",
                                    minute: "2-digit",
                                  })}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-1">
                                {group.participants.slice(0, 2).map((p) => (
                                  <div key={p.id} className="flex items-center gap-2 text-sm">
                                    {p.adjustment_type === "clawback" ? (
                                      <TrendingDown className="h-3 w-3 text-red-500" />
                                    ) : (
                                      <TrendingUp className="h-3 w-3 text-green-500" />
                                    )}
                                    <span>{p.participant_name}</span>
                                    <span className="text-muted-foreground text-xs">
                                      {p.old_split_pct}% → {p.new_split_pct}%
                                    </span>
                                  </div>
                                ))}
                                {group.participants.length > 2 && (
                                  <span className="text-xs text-muted-foreground">
                                    +{group.participants.length - 2} more
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-xs capitalize",
                                  group.adjustment_type === "clawback"
                                    ? "text-red-600 border-red-300 bg-red-50 dark:bg-red-950/50"
                                    : group.adjustment_type === "additional"
                                    ? "text-green-600 border-green-300 bg-green-50 dark:bg-green-950/50"
                                    : "text-blue-600 border-blue-300 bg-blue-50 dark:bg-blue-950/50"
                                )}
                              >
                                {group.adjustment_type}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <span className="text-sm text-muted-foreground truncate max-w-[200px] block">
                                {group.note || "-"}
                              </span>
                            </TableCell>
                            <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    setAdjustmentToConfirm(group)
                                    setConfirmDialogOpen(true)
                                  }}
                                  className="bg-green-600 hover:bg-green-700 text-white"
                                >
                                  <Check className="h-4 w-4 mr-1" />
                                  Confirm
                                </Button>
                                {firstParticipant?.deal_id && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => openViewDialogFromHistory(group.participants, firstParticipant.deal_id!)}
                                  >
                                    <Pencil className="h-4 w-4 mr-1" />
                                    Edit
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setAdjustmentToReject(group)
                                    setRejectDialogOpen(true)
                                  }}
                                  className="border-red-300 text-red-600 hover:bg-red-50"
                                >
                                  <RotateCcw className="h-4 w-4 mr-1" />
                                  Reject
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="participants" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <GitMerge className="h-5 w-5" />
                Merge Participants
              </CardTitle>
              <CardDescription>
                Combine duplicate or misnamed participants into a single record. Select a source (to remove) and target
                (to keep).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Selection Summary */}
              {(sourceParticipant || targetParticipant) && (
                <div className="rounded-lg border bg-muted/50 p-4">
                  <h4 className="mb-3 text-sm font-medium">Merge Preview</h4>
                  <div className="flex items-center gap-4">
                    <div className="flex-1 rounded-lg border bg-background p-3">
                      <p className="text-xs text-muted-foreground mb-1">Source (will be removed)</p>
                      {sourceParticipant ? (
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium">{sourceParticipant.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {sourceParticipant.payoutCount} payouts ·{" "}
                              <MoneyDisplay amount={sourceParticipant.totalAmount} />
                            </p>
                          </div>
                          <Button size="sm" variant="ghost" onClick={() => setSourceParticipant(null)}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <p className="text-muted-foreground text-sm">Click a participant below</p>
                      )}
                    </div>
                    <ArrowRight className="h-5 w-5 text-muted-foreground" />
                    <div className="flex-1 rounded-lg border bg-background p-3">
                      <p className="text-xs text-muted-foreground mb-1">Target (will be kept)</p>
                      {targetParticipant ? (
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium">{targetParticipant.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {targetParticipant.payoutCount} payouts ·{" "}
                              <MoneyDisplay amount={targetParticipant.totalAmount} />
                            </p>
                          </div>
                          <Button size="sm" variant="ghost" onClick={() => setTargetParticipant(null)}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <p className="text-muted-foreground text-sm">Click a participant below</p>
                      )}
                    </div>
                    <Button
                      disabled={!sourceParticipant || !targetParticipant}
                      onClick={() => setMergeDialogOpen(true)}
                    >
                      <GitMerge className="mr-2 h-4 w-4" />
                      Merge
                    </Button>
                  </div>
                </div>
              )}

              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search participants by name, ID, or role..."
                  value={participantSearch}
                  onChange={(e) => setParticipantSearch(e.target.value)}
                  className="pl-10"
                />
              </div>

              <div className="rounded-lg border">
                <div className="grid grid-cols-6 gap-4 border-b bg-muted/50 px-4 py-3 text-sm font-medium">
                  <div className="col-span-2">Participant</div>
                  <div>Role</div>
                  <div>Payouts</div>
                  <div>Total Amount</div>
                  <div>Actions</div>
                </div>

                {participantsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : filteredParticipants.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Users className="mb-2 h-8 w-8 text-muted-foreground/50" />
                    <p className="text-muted-foreground">No participants found</p>
                  </div>
                ) : (
                  filteredParticipants.map((participant) => {
                    const isSource = sourceParticipant?.id === participant.id
                    const isTarget = targetParticipant?.id === participant.id
                    return (
                      <div
                        key={participant.id}
                        className={cn(
                          "grid grid-cols-6 gap-4 border-b px-4 py-3 text-sm last:border-0",
                          isSource && "bg-red-50 dark:bg-red-950/20",
                          isTarget && "bg-green-50 dark:bg-green-950/20",
                        )}
                      >
                        <div className="col-span-2">
                          <p className="font-medium">{participant.name}</p>
                          <p className="text-xs text-muted-foreground">{participant.email || "No email"}</p>
                        </div>
                        <div>
                          <Badge variant="outline" className="capitalize">
                            {participant.role || "Unknown"}
                          </Badge>
                        </div>
                        <div>{participant.payoutCount}</div>
                        <div>
                          <MoneyDisplay amount={participant.totalAmount} />
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant={isSource ? "default" : "outline"}
                            onClick={() => setSourceParticipant(isSource ? null : participant)}
                            disabled={isTarget}
                            className={cn(isSource && "bg-red-600 hover:bg-red-700")}
                          >
                            {isSource ? <Check className="h-4 w-4" /> : "Source"}
                          </Button>
                          <Button
                            size="sm"
                            variant={isTarget ? "default" : "outline"}
                            onClick={() => setTargetParticipant(isTarget ? null : participant)}
                            disabled={isSource}
                            className={cn(isTarget && "bg-green-600 hover:bg-green-700")}
                          >
                            {isTarget ? <Check className="h-4 w-4" /> : "Target"}
                          </Button>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </CardContent>
          </Card>

          {/* Merge History */}
          {mergeHistory.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <History className="h-5 w-5" />
                  Merge History
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {mergeHistory.map((merge) => (
                    <div key={merge.id} className="rounded-lg border p-4">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium text-red-600">{merge.source_name}</span>
                        <ArrowRight className="h-3 w-3" />
                        <span className="font-medium text-green-600">{merge.target_name}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {merge.records_updated} records updated · {new Date(merge.created_at).toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ** CHANGE: Update the History tab UI to show both adjustments and merges ** */}
        <TabsContent value="history" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <History className="h-5 w-5" />
                    History
                  </CardTitle>
                  <CardDescription>
                    View all past adjustments and merges
                    {historyTotal > 0 && ` (${historyTotal} total)`}
                  </CardDescription>
                </div>
              </div>
              <div className="mt-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search by participant, deal, or note..."
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {historyLoading && adjustmentHistory.length === 0 ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : adjustmentHistory.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <History className="mb-2 h-8 w-8 text-muted-foreground/50" />
                  <p className="text-muted-foreground">
                    {historySearch ? "No history found matching your search" : "No history yet"}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {groupedAdjustmentHistory.map((item) => {
                    // Check if this is a merge (HistoryItem with type="merge") or an AdjustmentGroup
                    const isMerge = "type" in item && item.type === "merge"

                    if (isMerge) {
                      // Merge entry - not expandable
                      const mergeItem = item as HistoryItem
                      return (
                        <div key={mergeItem.id} className="rounded-lg border p-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Badge
                                variant="outline"
                                className="bg-purple-50 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300"
                              >
                                Merge
                              </Badge>
                              <span className="font-medium text-red-600">{mergeItem.source_name}</span>
                              <ArrowRight className="h-3 w-3 text-muted-foreground" />
                              <span className="font-medium text-green-600">{mergeItem.target_name}</span>
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {new Date(mergeItem.created_at).toLocaleString()}
                            </span>
                          </div>
                          <p className="mt-2 text-sm text-muted-foreground">{mergeItem.records_updated} records updated</p>
                        </div>
                      )
                    }

                    // Adjustment Group - expandable
                    const group = item as AdjustmentGroup & { deal_id?: string }
                    const isGroupExpanded = expandedAdjustmentGroups.has(group.id)
                    const firstParticipant = group.participants[0]

                    return (
                      <Collapsible
                        key={group.id}
                        open={isGroupExpanded}
                        onOpenChange={() => toggleAdjustmentGroupExpanded(group.id)}
                      >
                        <div
                          className={cn(
                            "rounded-lg border transition-colors",
                            group.status === "pending"
                              ? "bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900"
                              : "bg-background"
                          )}
                        >
                          {/* Adjustment Group Header */}
                          <CollapsibleTrigger asChild>
                            <div
                              className={cn(
                                "flex items-center justify-between p-4 cursor-pointer transition-colors",
                                group.status === "pending"
                                  ? "hover:bg-amber-100 dark:hover:bg-amber-950/40"
                                  : "hover:bg-muted/50"
                              )}
                            >
                              <div className="flex items-center gap-3">
                                {isGroupExpanded ? (
                                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                )}
                                {/* Adjustment type icon */}
                                {group.adjustment_type === "clawback" ? (
                                  <TrendingDown className="h-5 w-5 text-red-500" />
                                ) : group.adjustment_type === "additional" ? (
                                  <TrendingUp className="h-5 w-5 text-green-500" />
                                ) : (
                                  <div className="flex">
                                    <TrendingDown className="h-5 w-5 text-red-500" />
                                    <TrendingUp className="h-5 w-5 text-green-500 -ml-2" />
                                  </div>
                                )}
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium">
                                      {new Date(group.created_at).toLocaleDateString("en-US", {
                                        month: "short",
                                        day: "numeric",
                                        year: "numeric",
                                      })}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      {new Date(group.created_at).toLocaleTimeString("en-US", {
                                        hour: "numeric",
                                        minute: "2-digit",
                                      })}
                                    </span>
                                  </div>
                                  {group.note && (
                                    <p className="text-sm text-muted-foreground truncate max-w-[400px]">
                                      {group.note}
                                    </p>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                <Badge variant="secondary" className="text-xs">
                                  <Users className="mr-1 h-3 w-3" />
                                  {group.participants.length} participant{group.participants.length !== 1 ? "s" : ""}
                                </Badge>
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "text-xs capitalize",
                                    group.adjustment_type === "clawback"
                                      ? "text-red-600 border-red-300 bg-red-50 dark:bg-red-950/50"
                                      : group.adjustment_type === "additional"
                                      ? "text-green-600 border-green-300 bg-green-50 dark:bg-green-950/50"
                                      : "text-blue-600 border-blue-300 bg-blue-50 dark:bg-blue-950/50"
                                  )}
                                >
                                  {group.adjustment_type}
                                </Badge>
                                <div className="flex items-center gap-1.5">
                                  <Badge
                                    variant={group.status === "pending" ? "outline" : "secondary"}
                                    className={cn(
                                      "text-xs",
                                      group.status === "pending"
                                        ? "bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/50 dark:text-amber-300"
                                        : "bg-green-50 text-green-700 dark:bg-green-950/50 dark:text-green-300"
                                    )}
                                  >
                                    {group.status === "pending" ? (
                                      <>
                                        <Clock className="mr-1 h-3 w-3" />
                                        Pending
                                      </>
                                    ) : (
                                      <>
                                        <Check className="mr-1 h-3 w-3" />
                                        Confirmed
                                      </>
                                    )}
                                  </Badge>
                                  {group.status === "confirmed" && group.confirmed_at && (
                                    <div className="flex flex-col text-[10px] text-muted-foreground leading-tight" title={new Date(group.confirmed_at).toLocaleString()}>
                                      <span>
                                        {new Date(group.confirmed_at).toLocaleTimeString("en-US", {
                                          hour: "numeric",
                                          minute: "2-digit",
                                        })}
                                      </span>
                                      <span>
                                        {new Date(group.confirmed_at).toLocaleDateString("en-US", {
                                          month: "2-digit",
                                          day: "2-digit",
                                          year: "numeric",
                                        })}
                                      </span>
                                    </div>
                                  )}
                                </div>
                                {/* Edit/View button */}
                                {group.status === "pending" && firstParticipant?.deal_id ? (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      openViewDialogFromHistory(group.participants, firstParticipant.deal_id!)
                                    }}
                                  >
                                    <Pencil className="mr-1 h-3 w-3" />
                                    Edit
                                  </Button>
                                ) : firstParticipant?.deal_id ? (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      openViewDialogFromHistory(group.participants, firstParticipant.deal_id!)
                                    }}
                                  >
                                    <Eye className="mr-1 h-3 w-3" />
                                    View
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                          </CollapsibleTrigger>

                          {/* Expanded Participant Details */}
                          <CollapsibleContent>
                            <div className="border-t px-4 py-3 space-y-2">
                              {group.participants.map((adjustment) => (
                                <div
                                  key={adjustment.id}
                                  className={cn(
                                    "flex items-center justify-between p-3 rounded-lg border",
                                    adjustment.adjustment_type === "clawback"
                                      ? "bg-red-50/50 border-red-100 dark:bg-red-950/10 dark:border-red-900/50"
                                      : "bg-green-50/50 border-green-100 dark:bg-green-950/10 dark:border-green-900/50"
                                  )}
                                >
                                  <div className="flex items-center gap-4">
                                    <div className="flex items-center gap-2">
                                      {adjustment.adjustment_type === "clawback" ? (
                                        <TrendingDown className="h-4 w-4 text-red-500" />
                                      ) : (
                                        <TrendingUp className="h-4 w-4 text-green-500" />
                                      )}
                                      <span className="font-medium text-sm">
                                        {adjustment.participant_name || "Unknown"}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                      <span>{adjustment.old_split_pct?.toFixed(2)}%</span>
                                      <ArrowRight className="h-3 w-3" />
                                      <span className="font-medium text-foreground">
                                        {adjustment.new_split_pct?.toFixed(2)}%
                                      </span>
                                    </div>
                                    <Badge
                                      variant="outline"
                                      className={cn(
                                        "text-xs capitalize",
                                        adjustment.adjustment_type === "clawback"
                                          ? "text-red-600 border-red-300"
                                          : "text-green-600 border-green-300"
                                      )}
                                    >
                                      {adjustment.adjustment_type}
                                    </Badge>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {(() => {
                                      const dollarAmount = calculateAdjustmentDollarAmount(adjustment)
                                      return (
                                        <span
                                          className={cn(
                                            "text-sm font-medium",
                                            dollarAmount >= 0 ? "text-green-600" : "text-red-600"
                                          )}
                                        >
                                          {dollarAmount >= 0 ? "+" : ""}
                                          <MoneyDisplay amount={dollarAmount} />
                                        </span>
                                      )
                                    })()}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </CollapsibleContent>
                        </div>
                      </Collapsible>
                    )
                  })}

                  {/* Infinite scroll trigger */}
                  {historyHasMore && (
                    <div ref={historyLoaderRef} className="flex items-center justify-center py-4">
                      {historyLoading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Adjustment Dialog - Two-Column Layout with Payout Metrics */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>
              {dialogMode === "create" && `Create Adjustment for ${selectedDeal?.deal_id}`}
              {dialogMode === "edit" && `Edit Adjustment for ${selectedDeal?.deal_id}`}
              {dialogMode === "view" && `View Adjustment for ${selectedDeal?.deal_id}`}
            </DialogTitle>
            <DialogDescription>
              {dialogMode === "create" && "Modify participant splits to generate clawback or additional payout records"}
              {dialogMode === "edit" && "Update the pending adjustment before confirmation"}
              {dialogMode === "view" && "Review the details of this confirmed adjustment"}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4 py-2">
            {/* Two-Column Summary Section */}
            <div className="rounded-lg border bg-muted/50 p-4">
              <h4 className="mb-3 text-sm font-medium">Adjustment Summary</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Left Column - Deal Information */}
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                  {/* Left sub-column: Merchant, Partners, Net Residual */}
                  <div className="space-y-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Merchant Name</p>
                      <p className="font-medium">{selectedDeal?.merchant_name || "Unknown"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Partners</p>
                      <div className="space-y-2 mt-1">
                        {adjustmentParticipants.length > 0
                          ? adjustmentParticipants
                              .filter((p) => p.partner_name)
                              .map((p, idx) => (
                                <p key={idx} className="font-medium text-sm">
                                  {p.partner_name}
                                </p>
                              ))
                          : <p className="font-medium text-sm text-muted-foreground">No partners assigned</p>
                        }
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Net Residual</p>
                      <p className="font-medium">
                        {dealNetResidual !== null ? (
                          <MoneyDisplay amount={dealNetResidual} />
                        ) : (
                          <span className="text-muted-foreground">Loading...</span>
                        )}
                      </p>
                    </div>
                  </div>

                  {/* Right sub-column: Deal ID, Payout Type, Created, Updated */}
                  <div className="space-y-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Deal ID</p>
                      <p className="font-mono text-xs">{selectedDeal?.deal_id}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Payout Type</p>
                      <Badge variant="outline" className="capitalize mt-1">
                        {selectedDeal?.payout_type || "residual"}
                      </Badge>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Created</p>
                      <p className="font-medium text-sm">
                        {selectedDeal?.created_at
                          ? new Date(selectedDeal.created_at).toLocaleDateString()
                          : "--"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Updated</p>
                      <p className="font-medium text-sm">
                        {selectedDeal?.updated_at
                          ? new Date(selectedDeal.updated_at).toLocaleDateString()
                          : "--"}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Right Column - Per-Participant Payout Metrics (Stacked) */}
                <div className="space-y-4">
                  {adjustmentParticipants.map((participant) => {
                    const displayName = participant.partner_name || participant.partner_role || "Unnamed"
                    const oldPayout = dealNetResidual !== null
                      ? dealNetResidual * (participant.old_split_pct / 100)
                      : null
                    const newPayout = dealNetResidual !== null
                      ? dealNetResidual * (participant.new_split_pct / 100)
                      : null
                    const payoutDifference = oldPayout !== null && newPayout !== null
                      ? newPayout - oldPayout
                      : null

                    return (
                      <div key={participant.index} className="border-b pb-3 last:border-b-0 last:pb-0">
                        <p className="text-xs font-medium mb-2">{displayName}</p>
                        <div className="grid grid-cols-3 gap-x-4 text-sm">
                          <div>
                            <p className="text-xs text-muted-foreground">Previous Split</p>
                            <p className="font-semibold">
                              {oldPayout !== null ? (
                                <MoneyDisplay amount={oldPayout} />
                              ) : (
                                <span className="text-muted-foreground">--</span>
                              )}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">New Split</p>
                            <p className="font-semibold">
                              {newPayout !== null ? (
                                <MoneyDisplay amount={newPayout} />
                              ) : (
                                <span className="text-muted-foreground">--</span>
                              )}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Difference</p>
                            <p className={cn(
                              "font-semibold",
                              payoutDifference === null || payoutDifference === 0
                                ? "text-muted-foreground"
                                : payoutDifference < 0
                                  ? "text-red-600"
                                  : "text-green-600"
                            )}>
                              {payoutDifference !== null ? (
                                <>
                                  {payoutDifference > 0 ? "+" : ""}
                                  <MoneyDisplay amount={payoutDifference} />
                                </>
                              ) : (
                                <span className="text-muted-foreground">--</span>
                              )}
                            </p>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Participant Splits Table */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">Participant Splits</h4>
                {dialogMode !== "view" && (
                  <Button type="button" variant="outline" size="sm" onClick={addParticipant}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Participant
                  </Button>
                )}
              </div>

              {/* Table Header */}
              <div className="rounded-lg border">
                <div className="grid grid-cols-12 gap-2 border-b bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
                  <div className="col-span-3">Partner Name</div>
                  <div className="col-span-2">Role</div>
                  <div className="col-span-2 text-center">Old Split %</div>
                  <div className="col-span-2 text-center">New Split %</div>
                  <div className="col-span-2 text-center">Adjustment %</div>
                  <div className="col-span-1 text-center">Actions</div>
                </div>

                {/* Table Body */}
                {adjustmentParticipants.length === 0 ? (
                  <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                    No participants. Click "Add Participant" to add one.
                  </div>
                ) : (
                  adjustmentParticipants.map((participant) => (
                    <div
                      key={participant.index}
                      className="grid grid-cols-12 gap-2 items-center border-b last:border-0 px-3 py-2 text-sm"
                    >
                      {/* Partner Name */}
                      <div className="col-span-3">
                        {!participant.partner_name ? (
                          <Select
                            value={participant.partner_airtable_id}
                            onValueChange={(value) =>
                              updateParticipantDetails(participant.index, "partner_airtable_id", value)
                            }
                            disabled={dialogMode === "view"}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="Select partner" />
                            </SelectTrigger>
                            <SelectContent>
                              <div className="p-2 border-b sticky top-0 bg-white dark:bg-gray-950 z-10">
                                <Input
                                  placeholder="Search partners..."
                                  value={partnerSearchTerm}
                                  onChange={(e) => setPartnerSearchTerm(e.target.value)}
                                  className="h-7 text-xs"
                                  onClick={(e) => e.stopPropagation()}
                                  onPointerDown={(e) => e.stopPropagation()}
                                  onKeyDown={(e) => e.stopPropagation()}
                                  autoComplete="off"
                                />
                              </div>
                              <div className="max-h-[200px] overflow-y-auto">
                                {availablePartners
                                  .filter(
                                    (p) =>
                                      !partnerSearchTerm ||
                                      p.name.toLowerCase().includes(partnerSearchTerm.toLowerCase()) ||
                                      p.email.toLowerCase().includes(partnerSearchTerm.toLowerCase()),
                                  )
                                  .map((partner) => (
                                    <SelectItem key={partner.id} value={partner.id}>
                                      <div className="flex flex-col">
                                        <span className="font-medium text-xs">{partner.name}</span>
                                        <span className="text-xs text-muted-foreground">{partner.email}</span>
                                      </div>
                                    </SelectItem>
                                  ))}
                              </div>
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="font-medium text-sm truncate" title={participant.partner_name}>
                            {participant.partner_name}
                          </span>
                        )}
                      </div>

                      {/* Role */}
                      <div className="col-span-2">
                        {dialogMode === "view" ? (
                          <span className="text-sm">{participant.partner_role}</span>
                        ) : (
                          <Select
                            value={participant.partner_role}
                            onValueChange={(value) => updateParticipantDetails(participant.index, "partner_role", value)}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="Role" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Partner">Partner</SelectItem>
                              <SelectItem value="Sales Rep">Sales Rep</SelectItem>
                              <SelectItem value="Referral">Referral</SelectItem>
                              <SelectItem value="ISO">ISO</SelectItem>
                              <SelectItem value="Agent">Agent</SelectItem>
                              <SelectItem value="Investor">Investor</SelectItem>
                              <SelectItem value="Fund I">Fund I</SelectItem>
                              <SelectItem value="Fund II">Fund II</SelectItem>
                              <SelectItem value="Company">Company</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </div>

                      {/* Old Split % */}
                      <div className="col-span-2 text-center">
                        <span className="text-muted-foreground">{participant.old_split_pct}%</span>
                      </div>

                      {/* New Split % */}
                      <div className="col-span-2 flex justify-center">
                        {dialogMode === "view" ? (
                          <span className="font-medium">{participant.new_split_pct}%</span>
                        ) : (
                          <Input
                            type="number"
                            min="0"
                            max="100"
                            value={participant.new_split_pct}
                            onChange={(e) =>
                              updateParticipantDetails(
                                participant.index,
                                "new_split_pct",
                                Number.parseFloat(e.target.value) || 0,
                              )
                            }
                            className="h-8 w-20 text-center text-xs"
                          />
                        )}
                      </div>

                      {/* Adjustment % */}
                      <div className="col-span-2 text-center">
                        <span
                          className={cn(
                            "font-medium",
                            participant.new_split_pct - participant.old_split_pct === 0
                              ? "text-muted-foreground"
                              : participant.new_split_pct - participant.old_split_pct < 0
                                ? "text-red-600"
                                : "text-green-600",
                          )}
                        >
                          {participant.new_split_pct - participant.old_split_pct > 0 ? "+" : ""}
                          {(participant.new_split_pct - participant.old_split_pct).toFixed(2)}%
                        </span>
                      </div>

                      {/* Actions */}
                      <div className="col-span-1 flex justify-center">
                        {dialogMode !== "view" && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => removeParticipant(participant.index)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Total Split Validation */}
              <div className="flex justify-end">
                <div className={cn(
                  "text-sm font-medium px-3 py-1 rounded",
                  calculateTotalSplit() === 100
                    ? "text-green-600 bg-green-50 dark:bg-green-950/50"
                    : "text-red-600 bg-red-50 dark:bg-red-950/50"
                )}>
                  Total: {calculateTotalSplit()}%
                  {calculateTotalSplit() !== 100 && " (Must be 100%)"}
                </div>
              </div>
            </div>

            {/* Note */}
            <div className="space-y-2">
              <Label htmlFor="adjustment-note">{dialogMode === "view" ? "Note" : "Note (optional)"}</Label>
              {dialogMode === "view" ? (
                <p className="text-sm text-muted-foreground rounded-md border bg-muted/50 p-3 min-h-[60px]">
                  {adjustmentNote || "No note provided"}
                </p>
              ) : (
                <Textarea
                  id="adjustment-note"
                  placeholder="Enter a reason for this adjustment..."
                  value={adjustmentNote}
                  onChange={(e) => setAdjustmentNote(e.target.value)}
                />
              )}
            </div>
          </div>

          <DialogFooter className="shrink-0">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {dialogMode === "view" ? "Close" : "Cancel"}
            </Button>
            {dialogMode !== "view" && (
              <Button
                onClick={submitAdjustment}
                disabled={submitting || !adjustmentParticipants.some((p) => p.new_split_pct !== p.old_split_pct) || calculateTotalSplit() !== 100}
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {dialogMode === "edit" ? "Updating..." : "Submitting..."}
                  </>
                ) : (
                  dialogMode === "edit" ? "Update Adjustment" : "Submit Adjustment"
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={mergeDialogOpen} onOpenChange={setMergeDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Merge</AlertDialogTitle>
            <AlertDialogDescription>
              This will merge <span className="font-semibold text-red-600">{sourceParticipant?.name}</span> into{" "}
              <span className="font-semibold text-green-600">{targetParticipant?.name}</span>.
              <br />
              <br />
              All payouts and deal records for the source participant will be reassigned to the target. This action is
              logged and can be reviewed in history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleMerge} disabled={merging}>
              {merging ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Merging...
                </>
              ) : (
                "Confirm Merge"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Deal Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">Delete Deal</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4">
                <p>
                  You are about to permanently delete this deal and all associated data:
                </p>
                <div className="rounded-lg border bg-muted/50 p-3 space-y-1">
                  <p><span className="font-medium">Deal ID:</span> {dealToDelete?.deal_id}</p>
                  <p><span className="font-medium">Merchant:</span> {dealToDelete?.merchant_name || "Unknown"}</p>
                  <p><span className="font-medium">MID:</span> {dealToDelete?.mid}</p>
                  <p><span className="font-medium">Participants:</span> {dealToDelete?.participants_json?.length || 0}</p>
                </div>
                <p className="text-destructive font-medium">
                  This will also delete all payouts and CSV data associated with this deal. This action cannot be undone.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="delete-confirm">Type DELETE to confirm:</Label>
                  <Input
                    id="delete-confirm"
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    placeholder="DELETE"
                    className="font-mono"
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteConfirmText("")}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteDeal}
              disabled={deleting || deleteConfirmText !== "DELETE"}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete Deal
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Single Confirm Dialog */}
      <AlertDialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Adjustment</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>Are you sure you want to confirm this adjustment?</p>
                {adjustmentToConfirm && (
                  <div className="rounded-lg border bg-muted/50 p-3 space-y-2">
                    <p className="text-sm">
                      <span className="font-medium">Participants:</span> {adjustmentToConfirm.participants.length}
                    </p>
                    <p className="text-sm">
                      <span className="font-medium">Type:</span>{" "}
                      <span className="capitalize">{adjustmentToConfirm.adjustment_type}</span>
                    </p>
                    {adjustmentToConfirm.note && (
                      <p className="text-sm">
                        <span className="font-medium">Note:</span> {adjustmentToConfirm.note}
                      </p>
                    )}
                  </div>
                )}
                <p className="text-sm text-muted-foreground">
                  Once confirmed, this adjustment will be finalized and included in future payout calculations.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => adjustmentToConfirm && handleConfirmAdjustment(adjustmentToConfirm)}
              disabled={confirming}
              className="bg-green-600 hover:bg-green-700"
            >
              {confirming ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Confirming...
                </>
              ) : (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  Confirm
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Single Reject Dialog */}
      <AlertDialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject Adjustment</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>Are you sure you want to reject this adjustment?</p>
                {adjustmentToReject && (
                  <div className="rounded-lg border bg-muted/50 p-3 space-y-2">
                    <p className="text-sm">
                      <span className="font-medium">Participants:</span> {adjustmentToReject.participants.length}
                    </p>
                    <p className="text-sm">
                      <span className="font-medium">Type:</span>{" "}
                      <span className="capitalize">{adjustmentToReject.adjustment_type}</span>
                    </p>
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="reject-reason">Reason (optional):</Label>
                  <Textarea
                    id="reject-reason"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Enter reason for rejection..."
                    rows={2}
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  Rejected adjustments will be marked as undone and will not affect payouts.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setRejectReason("")}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => adjustmentToReject && handleRejectAdjustment(adjustmentToReject)}
              disabled={rejecting}
              className="bg-red-600 hover:bg-red-700"
            >
              {rejecting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Rejecting...
                </>
              ) : (
                <>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Reject
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Confirm Dialog */}
      <AlertDialog open={bulkConfirmDialogOpen} onOpenChange={setBulkConfirmDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Multiple Adjustments</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  You are about to confirm <strong>{selectedPendingAdjustments.size}</strong> pending adjustment(s).
                </p>
                <p className="text-sm text-muted-foreground">
                  Once confirmed, these adjustments will be finalized and included in future payout calculations.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkConfirm}
              disabled={confirming}
              className="bg-green-600 hover:bg-green-700"
            >
              {confirming ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Confirming...
                </>
              ) : (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  Confirm All
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Reject Dialog */}
      <AlertDialog open={bulkRejectDialogOpen} onOpenChange={setBulkRejectDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject Multiple Adjustments</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  You are about to reject <strong>{selectedPendingAdjustments.size}</strong> pending adjustment(s).
                </p>
                <div className="space-y-2">
                  <Label htmlFor="bulk-reject-reason">Reason (optional):</Label>
                  <Textarea
                    id="bulk-reject-reason"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Enter reason for rejection..."
                    rows={2}
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  Rejected adjustments will be marked as undone and will not affect payouts.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setRejectReason("")}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkReject}
              disabled={rejecting}
              className="bg-red-600 hover:bg-red-700"
            >
              {rejecting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Rejecting...
                </>
              ) : (
                <>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Reject All
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
