"use client"

import { useState, useEffect, useCallback, useRef } from "react"
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
} from "lucide-react"
import { cn } from "@/lib/utils"
import { MoneyDisplay } from "@/components/residuals/shared/MoneyDisplay"
import { useToast } from "@/hooks/use-toast"

interface Deal {
  id: string
  deal_id: string
  mid: string
  merchant_name: string | null
  payout_type: string
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
  // Adjustment specific
  deal_id?: string
  participant_name?: string
  old_split_pct?: number
  new_split_pct?: number
  adjustment_amount?: number
  adjustment_type?: "clawback" | "additional"
  note?: string
  // Merge specific
  source_name?: string
  target_name?: string
  records_updated?: number
  description?: string
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

export default function AdjustmentsPage() {
  const { toast } = useToast()
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
          // Include assignment, deal, participant_merge, and adjustment types
          // NOTE: "adjustment" entity_type doesn't exist yet - adjustments are logged as "assignment" or "deal" updates
          const relevantHistory: HistoryItem[] = json.data
            .filter((a: any) =>
              a.entity_type === "adjustment" ||
              a.entity_type === "participant_merge" ||
              a.entity_type === "assignment" ||
              a.entity_type === "deal"
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
                  deal_id: a.new_data?.deal_id || a.entity_id,
                  participant_id: a.new_data?.participant_id || a.new_data?.partner_airtable_id || "",
                  participant_name: a.new_data?.participant_name || a.new_data?.partner_name || a.entity_name || "",
                  old_split_pct: a.previous_data?.split_pct || a.new_data?.old_split_pct || 0,
                  new_split_pct: a.new_data?.split_pct || a.new_data?.new_split_pct || 0,
                  adjustment_amount: a.new_data?.adjustment_amount || 0,
                  adjustment_type: a.new_data?.adjustment_type || "update",
                  note: a.new_data?.note || a.description || "",
                  created_at: a.created_at,
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
  }, [fetchDeals])

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

  const openAdjustmentDialog = (deal: Deal) => {
    console.log("[v0] Opening adjustment dialog for deal:", {
      id: deal.id,
      deal_id: deal.deal_id,
      mid: deal.mid,
    })
    setSelectedDeal(deal)
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

  const submitAdjustment = async () => {
    if (!selectedDeal) return

    setSubmitting(true)
    try {
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

      // Log each participant adjustment to action history
      for (const participant of adjustmentParticipants) {
        const adjustmentAmount = participant.new_split_pct - participant.old_split_pct
        if (adjustmentAmount !== 0) {
          await fetch("/api/history", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action_type: "update",
              entity_type: "adjustment",
              entity_id: selectedDeal.id, // Use selectedDeal.id (UUID)
              entity_name: `${selectedDeal.merchant_name || selectedDeal.deal_id} - ${participant.partner_name}`,
              previous_data: {
                split_pct: participant.old_split_pct,
              },
              new_data: {
                deal_id: selectedDeal.id, // Use selectedDeal.id (UUID)
                participant_id: participant.partner_airtable_id,
                participant_name: participant.partner_name,
                old_split_pct: participant.old_split_pct,
                new_split_pct: participant.new_split_pct,
                adjustment_amount: adjustmentAmount,
                adjustment_type: adjustmentAmount < 0 ? "clawback" : "additional",
                note: adjustmentNote,
              },
              description: `Adjusted ${participant.partner_name}'s split from ${participant.old_split_pct}% to ${participant.new_split_pct}% (${adjustmentAmount > 0 ? "+" : ""}${adjustmentAmount}%)`,
            }),
          })
        }
      }

      fetchDeals()
      setDialogOpen(false)
      fetchHistory()
    } catch (error) {
      console.error("Failed to submit adjustment:", error)
      alert(error instanceof Error ? error.message : "Failed to save adjustment")
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

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
    }).format(amount)
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

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="create">Create Adjustment</TabsTrigger>
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
                <div className="grid grid-cols-6 gap-4 border-b bg-muted/50 px-4 py-3 text-sm font-medium">
                  <div>Deal ID</div>
                  <div>Merchant</div>
                  <div>MID</div>
                  <div>Payout Type</div>
                  <div>Participants</div>
                  <div>Actions</div>
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
                  filteredDeals.map((deal) => (
                    <div key={deal.id} className="grid grid-cols-6 gap-4 border-b px-4 py-3 text-sm last:border-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs">{deal.deal_id}</span>
                        {deal.is_pending && (
                          <Badge
                            variant="outline"
                            className="bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 text-xs"
                          >
                            <Clock className="mr-1 h-3 w-3" />
                            Pending
                          </Badge>
                        )}
                      </div>
                      <div>{deal.merchant_name || "Unknown"}</div>
                      <div className="font-mono text-xs">{deal.mid}</div>
                      <div>
                        <Badge variant="outline" className="capitalize">
                          {deal.payout_type || "residual"}
                        </Badge>
                      </div>
                      <div>{(deal.participants_json || []).filter((p) => p.split_pct > 0).length} participants</div>
                      <div className="flex items-center gap-2">
                        <Button size="sm" onClick={() => openAdjustmentDialog(deal)}>
                          Create Adjustment
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => openDeleteDialog(deal)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
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
                  {adjustmentHistory.map(
                    (
                      item: HistoryItem, // Changed type to HistoryItem
                    ) => (
                      <div key={item.id} className="rounded-lg border p-4">
                        {item.type === "merge" ? (
                          <>
                            {/* Merge entry */}
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Badge
                                  variant="outline"
                                  className="bg-purple-50 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300"
                                >
                                  Merge
                                </Badge>
                                <span className="font-medium text-red-600">{item.source_name}</span>
                                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                                <span className="font-medium text-green-600">{item.target_name}</span>
                              </div>
                              <span className="text-xs text-muted-foreground">
                                {new Date(item.created_at).toLocaleString()}
                              </span>
                            </div>
                            <p className="mt-2 text-sm text-muted-foreground">{item.records_updated} records updated</p>
                          </>
                        ) : (
                          <>
                            {/* Adjustment entry */}
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    item.adjustment_type === "clawback"
                                      ? "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300"
                                      : "bg-green-50 text-green-700 dark:bg-green-950/50 dark:text-green-300",
                                  )}
                                >
                                  {item.adjustment_type === "clawback" ? "Clawback" : "Additional"}
                                </Badge>
                                <span className="font-medium">{item.participant_name}</span>
                              </div>
                              <span className="text-xs text-muted-foreground">
                                {new Date(item.created_at).toLocaleString()}
                              </span>
                            </div>
                            <div className="mt-2 flex items-center gap-4 text-sm">
                              <span className="text-muted-foreground">
                                Split: {item.old_split_pct}% → {item.new_split_pct}%
                              </span>
                              <span
                                className={cn(
                                  "font-medium",
                                  (item.adjustment_amount ?? 0) >= 0 ? "text-green-600" : "text-red-600",
                                )}
                              >
                                {(item.adjustment_amount ?? 0) >= 0 ? "+" : ""}
                                <MoneyDisplay amount={item.adjustment_amount ?? 0} />
                              </span>
                            </div>
                            {item.note && <p className="mt-2 text-sm text-muted-foreground">{item.note}</p>}
                          </>
                        )}
                      </div>
                    ),
                  )}

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

      {/* Adjustment Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Adjustment for {selectedDeal?.deal_id}</DialogTitle>
            <DialogDescription>
              Modify participant splits to generate clawback or additional payout records
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Summary */}
            <div className="rounded-lg border bg-muted/50 p-4">
              <h4 className="mb-2 text-sm font-medium">Adjustment Summary</h4>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-xs text-muted-foreground">Total Adjustment</p>
                  <p className="text-lg font-semibold">{calculateTotalAdjustment().toFixed(2)}%</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Clawbacks</p>
                  <p className="text-lg font-semibold text-red-600">-{calculateClawbacks().toFixed(2)}%</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Additional</p>
                  <p className="text-lg font-semibold text-green-600">+{calculateAdditional().toFixed(2)}%</p>
                </div>
              </div>
            </div>

            {/* Participant Splits */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">Participant Splits</h4>
                <Button type="button" variant="outline" size="sm" onClick={addParticipant}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Participant
                </Button>
              </div>
              {adjustmentParticipants.map(
                (
                  participant, // Changed from adjustmentSplits to adjustmentParticipants
                ) => (
                  <div key={participant.index} className="rounded-lg border bg-card p-4">
                    <div className="flex items-center justify-between">
                      <div className="min-w-[150px]">
                        {!participant.partner_name ? (
                          <div className="space-y-2">
                            <Select
                              value={participant.partner_airtable_id}
                              onValueChange={(value) =>
                                updateParticipantDetails(participant.index, "partner_airtable_id", value)
                              }
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Select partner" />
                              </SelectTrigger>
                              <SelectContent>
                                <div className="p-2 border-b sticky top-0 bg-white z-10">
                                  <Input
                                    placeholder="Search partners..."
                                    value={partnerSearchTerm}
                                    onChange={(e) => setPartnerSearchTerm(e.target.value)}
                                    className="h-8"
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
                                          <span className="font-medium">{partner.name}</span>
                                          <span className="text-xs text-muted-foreground">{partner.email}</span>
                                        </div>
                                      </SelectItem>
                                    ))}
                                </div>
                              </SelectContent>
                            </Select>
                            <Select
                              value={participant.partner_role}
                              onValueChange={(value) => updateParticipantDetails(participant.index, "partner_role", value)}
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Select role" />
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
                              </SelectContent>
                            </Select>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <p className="font-medium">{participant.partner_name}</p>
                            <Select
                              value={participant.partner_role}
                              onValueChange={(value) => updateParticipantDetails(participant.index, "partner_role", value)}
                            >
                              <SelectTrigger className="w-full h-8">
                                <SelectValue placeholder="Select role" />
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
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right text-sm">
                          <p className="text-muted-foreground">Old Split</p>
                          <p>{participant.old_split_pct}%</p>
                        </div>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                        <div className="w-20">
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
                            className="text-center"
                          />
                        </div>
                        <div className="w-20 text-right">
                          <p className="text-xs text-muted-foreground">Adjustment</p>
                          <p
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
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => removeParticipant(participant.index)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ),
              )}
            </div>

            {/* Note */}
            <div className="space-y-2">
              <Label htmlFor="adjustment-note">Note (optional)</Label>
              <Textarea
                id="adjustment-note"
                placeholder="Enter a reason for this adjustment..."
                value={adjustmentNote}
                onChange={(e) => setAdjustmentNote(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={submitAdjustment}
              disabled={submitting || !adjustmentParticipants.some((p) => p.new_split_pct !== p.old_split_pct)}
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                "Submit Adjustment"
              )}
            </Button>
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
    </div>
  )
}
