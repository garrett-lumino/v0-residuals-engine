"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { MoneyDisplay } from "@/components/residuals/shared/MoneyDisplay"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Search,
  Download,
  FileText,
  DollarSign,
  CheckCircle2,
  TrendingUp,
  Check,
  Loader2,
  ChevronUp,
  ChevronDown,
  ArrowUpDown,
  Users,
  Calendar,
  BarChart3,
  Eye,
  Layers,
} from "lucide-react"
import Link from "next/link"
import { EditPayoutButton } from "./EditPayoutButton"
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
import { formatPayoutMonth } from "@/lib/utils/formatters"

interface Payout {
  id: string
  payout_month: string
  partner_airtable_id: string
  partner_role: string
  partner_name?: string
  partner_email?: string
  deal_id: string
  merchant_name: string
  mid: string
  volume: string
  fees: string
  net_residual: string
  partner_split_pct: string
  partner_payout_amount: string
  payout_type: string
  paid_status: string
  is_legacy_import: boolean
}

interface AgentSummary {
  partner_airtable_id: string
  partner_name: string
  partner_email: string
  total_payout: number
  line_item_count: number
  paid_count: number
  unpaid_count: number
}

interface MonthlySummary {
  month: string
  total_amount: number
  total_payouts: number
  unique_agents: number
  average_payout: number
}

interface QuarterlySummary {
  quarter: string
  total_amount: number
  total_payouts: number
  average_payout: number
}

interface Props {
  initialPayouts: Payout[]
  total: number
  stats: {
    totalAmount: number
    paidAmount: number
    paidCount: number
    totalCount: number
  }
}

type SortField =
  | "payout_month"
  | "partner_name"
  | "merchant_name"
  | "mid"
  | "partner_split_pct"
  | "partner_payout_amount"
  | "payout_type"
  | "paid_status"
type SortDirection = "asc" | "desc"

const formatQuarter = (quarter: string) => {
  // quarter format: "2025-Q1"
  const [year, q] = quarter.split("-")
  return `${q} ${year}`
}

export function PayoutsDetailedView({ initialPayouts, total, stats }: Props) {
  const [activeTab, setActiveTab] = useState("detailed")

  // Detailed View State
  const [payouts, setPayouts] = useState<Payout[]>(initialPayouts)
  const [filteredPayouts, setFilteredPayouts] = useState<Payout[]>(initialPayouts)
  const [searchQuery, setSearchQuery] = useState("")
  const [monthFilter, setMonthFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [typeFilter, setTypeFilter] = useState("all")
  const [roleFilter, setRoleFilter] = useState("all")
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(initialPayouts.length < total)
  const [allMonths, setAllMonths] = useState<string[]>([])
  const observerTarget = useRef<HTMLDivElement>(null)
  const loadingRef = useRef(false)
  const payoutsLengthRef = useRef(payouts.length)

  // By Agent State
  const [agentData, setAgentData] = useState<AgentSummary[]>([])
  const [agentLoading, setAgentLoading] = useState(false)
  const [agentHasMore, setAgentHasMore] = useState(true)
  const [agentOffset, setAgentOffset] = useState(0)
  const agentObserverTarget = useRef<HTMLDivElement>(null)
  const agentLoadingRef = useRef(false)
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set())

  // Monthly Summary State
  const [monthlyData, setMonthlyData] = useState<MonthlySummary[]>([])
  const [monthlyLoading, setMonthlyLoading] = useState(false)

  // Quarterly Summary State
  const [quarterlyData, setQuarterlyData] = useState<QuarterlySummary[]>([])
  const [quarterlyLoading, setQuarterlyLoading] = useState(false)

  const [sortField, setSortField] = useState<SortField>("payout_month")
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc")

  const [markPaidDialogOpen, setMarkPaidDialogOpen] = useState(false)
  const [payoutToMarkPaid, setPayoutToMarkPaid] = useState<Payout | null>(null)
  const [markingPaid, setMarkingPaid] = useState(false)

  // Mass Payout Dialog
  const [massPaidDialogOpen, setMassPaidDialogOpen] = useState(false)
  const [massMarkingPaid, setMassMarkingPaid] = useState(false)

  useEffect(() => {
    payoutsLengthRef.current = payouts.length
  }, [payouts.length])

  useEffect(() => {
    async function fetchUniqueMonths() {
      try {
        const response = await fetch("/api/payouts/unique-months")
        const data = await response.json()
        if (data.months) {
          setAllMonths(data.months)
        }
      } catch (error) {
        console.error("[v0] Error fetching unique months:", error)
      }
    }
    fetchUniqueMonths()
  }, [])

  // Load data when tab changes
  useEffect(() => {
    if (activeTab === "by-agent" && agentData.length === 0) {
      fetchAgentData()
    } else if (activeTab === "monthly" && monthlyData.length === 0) {
      fetchMonthlyData()
    } else if (activeTab === "quarterly" && quarterlyData.length === 0) {
      fetchQuarterlyData()
    }
  }, [activeTab])

  const fetchAgentData = async (reset = false) => {
    if (agentLoadingRef.current) return
    agentLoadingRef.current = true
    setAgentLoading(true)

    try {
      const offset = reset ? 0 : agentOffset
      const response = await fetch(`/api/payouts/by-agent?offset=${offset}&limit=50`)
      const data = await response.json()

      if (data.agents && data.agents.length > 0) {
        if (reset) {
          setAgentData(data.agents)
          setAgentOffset(data.agents.length)
        } else {
          setAgentData((prev) => [...prev, ...data.agents])
          setAgentOffset((prev) => prev + data.agents.length)
        }
        setAgentHasMore(data.agents.length === 50)
      } else {
        setAgentHasMore(false)
      }
    } catch (error) {
      console.error("[v0] Error fetching agent data:", error)
    } finally {
      agentLoadingRef.current = false
      setAgentLoading(false)
    }
  }

  const fetchMonthlyData = async () => {
    setMonthlyLoading(true)
    try {
      const response = await fetch("/api/payouts/monthly-summary")
      const data = await response.json()
      if (data.summary) {
        setMonthlyData(data.summary)
      }
    } catch (error) {
      console.error("[v0] Error fetching monthly data:", error)
    } finally {
      setMonthlyLoading(false)
    }
  }

  const fetchQuarterlyData = async () => {
    setQuarterlyLoading(true)
    try {
      const response = await fetch("/api/payouts/quarterly-summary")
      const data = await response.json()
      if (data.summary) {
        setQuarterlyData(data.summary)
      }
    } catch (error) {
      console.error("[v0] Error fetching quarterly data:", error)
    } finally {
      setQuarterlyLoading(false)
    }
  }

  useEffect(() => {
    let filtered = [...payouts]

    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(
        (p) =>
          p.merchant_name?.toLowerCase().includes(query) ||
          p.partner_name?.toLowerCase().includes(query) ||
          p.partner_airtable_id?.toLowerCase().includes(query) ||
          p.mid?.toLowerCase().includes(query) ||
          p.deal_id?.toLowerCase().includes(query),
      )
    }

    if (monthFilter !== "all") {
      filtered = filtered.filter((p) => p.payout_month === monthFilter)
    }

    if (statusFilter !== "all") {
      filtered = filtered.filter((p) => p.paid_status === statusFilter)
    }

    if (typeFilter !== "all") {
      filtered = filtered.filter((p) => p.payout_type === typeFilter)
    }

    if (roleFilter !== "all") {
      filtered = filtered.filter((p) => p.partner_role === roleFilter)
    }

    setFilteredPayouts(filtered)
  }, [searchQuery, monthFilter, statusFilter, typeFilter, roleFilter, payouts])

  const sortedPayouts = [...filteredPayouts].sort((a, b) => {
    let aVal: any = a[sortField]
    let bVal: any = b[sortField]

    if (sortField === "partner_name") {
      aVal = a.partner_name || a.partner_role || ""
      bVal = b.partner_name || b.partner_role || ""
    }

    if (aVal === null || aVal === undefined) aVal = ""
    if (bVal === null || bVal === undefined) bVal = ""

    if (sortField === "partner_split_pct" || sortField === "partner_payout_amount") {
      aVal = Number.parseFloat(aVal) || 0
      bVal = Number.parseFloat(bVal) || 0
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
    <th
      className={`text-left p-3 text-sm font-medium cursor-pointer hover:bg-muted/50 select-none ${className}`}
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
    </th>
  )

  const refreshPayouts = useCallback(async () => {
    try {
      const response = await fetch(`/api/payouts/list?offset=0&limit=${payoutsLengthRef.current || 50}`)
      const data = await response.json()
      if (data.payouts) {
        setPayouts(data.payouts)
      }
    } catch (error) {
      console.error("[v0] Error refreshing payouts:", error)
    }
  }, [])

  const loadMore = useCallback(async () => {
    if (loadingRef.current) return

    loadingRef.current = true
    setLoading(true)
    try {
      const response = await fetch(`/api/payouts/list?offset=${payoutsLengthRef.current}&limit=50`)
      const data = await response.json()

      if (data.payouts && data.payouts.length > 0) {
        setPayouts((prev) => {
          const existingIds = new Set(prev.map((p) => p.id))
          const newPayouts = data.payouts.filter((p: Payout) => !existingIds.has(p.id))
          const combined = [...prev, ...newPayouts]
          setHasMore(combined.length < total)
          return combined
        })
      } else {
        setHasMore(false)
      }
    } catch (error) {
      console.error("[v0] Error loading more payouts:", error)
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }, [total])

  useEffect(() => {
    const target = observerTarget.current
    if (!target || activeTab !== "detailed") return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loadingRef.current && hasMore) {
          loadMore()
        }
      },
      { threshold: 0.1 },
    )

    observer.observe(target)

    return () => observer.disconnect()
  }, [loadMore, hasMore, activeTab])

  // Agent tab lazy loading
  useEffect(() => {
    const target = agentObserverTarget.current
    if (!target || activeTab !== "by-agent") return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !agentLoadingRef.current && agentHasMore) {
          fetchAgentData()
        }
      },
      { threshold: 0.1 },
    )

    observer.observe(target)

    return () => observer.disconnect()
  }, [agentHasMore, activeTab])

  const handleExportAirtable = () => {
    window.location.href = "/api/payouts/export-airtable?status=all"
  }

  const handleExportSummary = () => {
    window.location.href = "/api/payouts/export-summary"
  }

  const handleExportCSV = () => {
    window.location.href = "/api/payouts/export-csv"
  }

  const handleMarkPaidClick = (payout: Payout) => {
    setPayoutToMarkPaid(payout)
    setMarkPaidDialogOpen(true)
  }

  const handleConfirmMarkPaid = async () => {
    if (!payoutToMarkPaid) return

    setMarkingPaid(true)
    try {
      const res = await fetch(`/api/residuals/payouts/${payoutToMarkPaid.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paid_status: "paid",
          paid_at: new Date().toISOString(),
        }),
      })

      if (res.ok) {
        setPayouts((prev) => prev.map((p) => (p.id === payoutToMarkPaid.id ? { ...p, paid_status: "paid" } : p)))
      } else {
        console.error("Failed to mark as paid")
      }
    } catch (error) {
      console.error("Error marking as paid:", error)
    } finally {
      setMarkingPaid(false)
      setMarkPaidDialogOpen(false)
      setPayoutToMarkPaid(null)
    }
  }

  const handleMassPayoutClick = () => {
    if (selectedAgents.size === 0) return
    setMassPaidDialogOpen(true)
  }

  const handleConfirmMassPaid = async () => {
    setMassMarkingPaid(true)
    try {
      const res = await fetch("/api/payouts/mass-mark-paid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partnerIds: Array.from(selectedAgents),
        }),
      })

      if (res.ok) {
        // Refresh agent data
        fetchAgentData(true)
        setSelectedAgents(new Set())
      }
    } catch (error) {
      console.error("Error mass marking as paid:", error)
    } finally {
      setMassMarkingPaid(false)
      setMassPaidDialogOpen(false)
    }
  }

  const toggleAgentSelection = (partnerId: string) => {
    setSelectedAgents((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(partnerId)) {
        newSet.delete(partnerId)
      } else {
        newSet.add(partnerId)
      }
      return newSet
    })
  }

  const toggleAllAgents = () => {
    if (selectedAgents.size === agentData.length) {
      setSelectedAgents(new Set())
    } else {
      setSelectedAgents(new Set(agentData.map((a) => a.partner_airtable_id)))
    }
  }

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Payout Management</h1>
          <p className="text-muted-foreground mt-2">Track and manage all payout data with multiple view options</p>
        </div>
        <div className="flex gap-2">
          {activeTab === "by-agent" && selectedAgents.size > 0 && (
            <Button onClick={handleMassPayoutClick}>
              <Layers className="mr-2 h-4 w-4" />
              Mass Payout ({selectedAgents.size})
            </Button>
          )}
          <Link href="/residuals/payouts">
            <Button variant="outline">Back to Overview</Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Payouts</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              <MoneyDisplay amount={stats.totalAmount} />
            </div>
            <p className="text-xs text-muted-foreground">{stats.totalCount} total records</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Payments</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalCount - stats.paidCount}</div>
            <p className="text-xs text-muted-foreground">Awaiting payment</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Completed</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.paidCount}</div>
            <p className="text-xs text-muted-foreground">Paid out</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Paid Out</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              <MoneyDisplay amount={stats.paidAmount} />
            </div>
            <p className="text-xs text-muted-foreground">From {stats.paidCount} payments</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="detailed" className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Detailed View
              </TabsTrigger>
              <TabsTrigger value="by-agent" className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                By Agent
              </TabsTrigger>
              <TabsTrigger value="monthly" className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Monthly Summary
              </TabsTrigger>
              <TabsTrigger value="quarterly" className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                Quarterly Summary
              </TabsTrigger>
            </TabsList>

            {/* Filters - shown for detailed and by-agent tabs */}
            {(activeTab === "detailed" || activeTab === "by-agent") && (
              <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
                <div className="relative w-full lg:w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder={activeTab === "detailed" ? "Search merchants, agents, MIDs..." : "Search merchant"}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  <Select value={monthFilter} onValueChange={setMonthFilter}>
                    <SelectTrigger className="w-[140px]">
                      <SelectValue placeholder="All Months" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Months</SelectItem>
                      {allMonths.map((month) => (
                        <SelectItem key={month} value={month}>
                          {formatPayoutMonth(month)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-[140px]">
                      <SelectValue placeholder="All Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="paid">Paid</SelectItem>
                      <SelectItem value="unpaid">Unpaid</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select value={typeFilter} onValueChange={setTypeFilter}>
                    <SelectTrigger className="w-[140px]">
                      <SelectValue placeholder="All Types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Types</SelectItem>
                      <SelectItem value="residual">Residual</SelectItem>
                      <SelectItem value="upfront">Upfront</SelectItem>
                      <SelectItem value="trueup">True-Up</SelectItem>
                      <SelectItem value="bonus">Bonus</SelectItem>
                      <SelectItem value="clawback">Clawback</SelectItem>
                      <SelectItem value="adjustment">Adjustment</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select value={roleFilter} onValueChange={setRoleFilter}>
                    <SelectTrigger className="w-[140px]">
                      <SelectValue placeholder="All Roles" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Roles</SelectItem>
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

                  {activeTab === "by-agent" && (
                    <Button variant="outline" onClick={handleExportCSV}>
                      <FileText className="mr-2 h-4 w-4" />
                      Export CSV
                    </Button>
                  )}

                  <Button variant="outline" onClick={handleExportSummary}>
                    <BarChart3 className="mr-2 h-4 w-4" />
                    Export Summary
                  </Button>

                  <Button variant="outline" onClick={handleExportAirtable}>
                    <Download className="mr-2 h-4 w-4" />
                    Export Detailed
                  </Button>
                </div>
              </div>
            )}

            {/* Detailed View Tab */}
            <TabsContent value="detailed" className="mt-0">
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full">
                  <thead className="bg-muted/50">
                    <tr className="border-b">
                      <th className="w-10 p-3">
                        <Checkbox />
                      </th>
                      <SortableHeader field="payout_month" label="Payout Month" />
                      <SortableHeader field="partner_name" label="Agent" />
                      <th className="text-left p-3 text-sm font-medium">Deal ID</th>
                      <SortableHeader field="merchant_name" label="Merchant" />
                      <SortableHeader field="mid" label="MID" />
                      <th className="text-left p-3 text-sm font-medium">Volume</th>
                      <SortableHeader field="partner_payout_amount" label="Amount" className="text-right" />
                      <SortableHeader field="payout_type" label="Payout Type" />
                      <th className="text-center p-3 text-sm font-medium">Mark as Paid</th>
                      <th className="text-center p-3 text-sm font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedPayouts.length === 0 ? (
                      <tr>
                        <td colSpan={11} className="p-12 text-center text-muted-foreground">
                          <DollarSign className="h-12 w-12 mx-auto mb-4 opacity-20" />
                          <p>No payouts found</p>
                        </td>
                      </tr>
                    ) : (
                      sortedPayouts.map((payout, index) => (
                        <tr key={`${payout.id}-${index}`} className="border-b hover:bg-muted/20">
                          <td className="p-3">
                            <Checkbox />
                          </td>
                          <td className="p-3 text-sm">{formatPayoutMonth(payout.payout_month)}</td>
                          <td className="p-3 text-sm">{payout.partner_name || payout.partner_role || "Unknown"}</td>
                          <td className="p-3 text-sm font-mono text-muted-foreground">{payout.deal_id}</td>
                          <td className="p-3 text-sm">{payout.merchant_name}</td>
                          <td className="p-3 text-sm font-mono">{payout.mid}</td>
                          <td className="p-3 text-sm">
                            <MoneyDisplay amount={Number.parseFloat(payout.volume) || 0} />
                          </td>
                          <td className="p-3 text-sm text-right font-medium">
                            <MoneyDisplay amount={Number.parseFloat(payout.partner_payout_amount)} />
                          </td>
                          <td className="p-3 text-sm">
                            <Badge variant="outline">{payout.payout_type}</Badge>
                          </td>
                          <td className="p-3 text-center">
                            {payout.paid_status === "paid" ? (
                              <div className="inline-flex items-center gap-1.5 text-green-600">
                                <div className="h-6 w-6 rounded-full bg-green-100 flex items-center justify-center">
                                  <Check className="h-4 w-4" />
                                </div>
                                <span className="text-sm font-medium">Paid</span>
                              </div>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleMarkPaidClick(payout)}
                                className="text-amber-600 border-amber-300 hover:bg-amber-50 hover:text-amber-700"
                              >
                                <DollarSign className="h-4 w-4 mr-1" />
                                Mark Paid
                              </Button>
                            )}
                          </td>
                          <td className="p-3 text-center">
                            <EditPayoutButton payout={payout} onUpdate={refreshPayouts} />
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {hasMore && (
                <div ref={observerTarget} className="p-4 text-center text-sm text-muted-foreground">
                  {loading ? (
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading more payouts...
                    </div>
                  ) : (
                    "Scroll for more"
                  )}
                </div>
              )}

              {!hasMore && sortedPayouts.length > 0 && (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  Showing all {sortedPayouts.length} payouts
                </div>
              )}
            </TabsContent>

            {/* By Agent Tab */}
            <TabsContent value="by-agent" className="mt-0">
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full">
                  <thead className="bg-muted/50">
                    <tr className="border-b">
                      <th className="w-10 p-3">
                        <Checkbox
                          checked={selectedAgents.size === agentData.length && agentData.length > 0}
                          onCheckedChange={toggleAllAgents}
                        />
                      </th>
                      <th className="text-left p-3 text-sm font-medium">Partner</th>
                      <th className="text-left p-3 text-sm font-medium">Email</th>
                      <th className="text-left p-3 text-sm font-medium">Total Payout (All Time)</th>
                      <th className="text-left p-3 text-sm font-medium"># of Line Items</th>
                      <th className="text-center p-3 text-sm font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agentLoading && agentData.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-12 text-center">
                          <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
                        </td>
                      </tr>
                    ) : agentData.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-12 text-center text-muted-foreground">
                          <Users className="h-12 w-12 mx-auto mb-4 opacity-20" />
                          <p>No agent data found</p>
                        </td>
                      </tr>
                    ) : (
                      agentData.map((agent) => (
                        <tr key={agent.partner_airtable_id} className="border-b hover:bg-muted/20">
                          <td className="p-3">
                            <Checkbox
                              checked={selectedAgents.has(agent.partner_airtable_id)}
                              onCheckedChange={() => toggleAgentSelection(agent.partner_airtable_id)}
                            />
                          </td>
                          <td className="p-3 text-sm font-medium">{agent.partner_name || "Unknown"}</td>
                          <td className="p-3 text-sm text-muted-foreground">{agent.partner_email || "-"}</td>
                          <td className="p-3 text-sm font-medium">
                            <MoneyDisplay amount={agent.total_payout} />
                          </td>
                          <td className="p-3 text-sm">{agent.line_item_count}</td>
                          <td className="p-3 text-center">
                            <Link href={`/residuals/payouts/by-participant?partner=${agent.partner_airtable_id}`}>
                              <Button variant="ghost" size="sm">
                                <Eye className="h-4 w-4 mr-1" />
                                View
                              </Button>
                            </Link>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {agentHasMore && (
                <div ref={agentObserverTarget} className="p-4 text-center text-sm text-muted-foreground">
                  {agentLoading ? (
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading more agents...
                    </div>
                  ) : (
                    "Scroll for more"
                  )}
                </div>
              )}

              {!agentHasMore && agentData.length > 0 && (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  Showing all {agentData.length} agents
                </div>
              )}
            </TabsContent>

            {/* Monthly Summary Tab */}
            <TabsContent value="monthly" className="mt-0">
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full">
                  <thead className="bg-muted/50">
                    <tr className="border-b">
                      <th className="text-left p-3 text-sm font-medium">Month</th>
                      <th className="text-left p-3 text-sm font-medium">Total Amount</th>
                      <th className="text-left p-3 text-sm font-medium">Total Payouts</th>
                      <th className="text-left p-3 text-sm font-medium">Unique Agents</th>
                      <th className="text-left p-3 text-sm font-medium">Average Payout</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyLoading ? (
                      <tr>
                        <td colSpan={5} className="p-12 text-center">
                          <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
                        </td>
                      </tr>
                    ) : monthlyData.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-12 text-center text-muted-foreground">
                          <BarChart3 className="h-12 w-12 mx-auto mb-4 opacity-20" />
                          <p>No monthly data available</p>
                        </td>
                      </tr>
                    ) : (
                      monthlyData.map((row) => (
                        <tr key={row.month} className="border-b hover:bg-muted/20">
                          <td className="p-3 text-sm font-medium">{formatPayoutMonth(row.month)}</td>
                          <td className="p-3 text-sm">
                            <MoneyDisplay amount={row.total_amount} />
                          </td>
                          <td className="p-3 text-sm">{row.total_payouts}</td>
                          <td className="p-3 text-sm">{row.unique_agents}</td>
                          <td className="p-3 text-sm">
                            <MoneyDisplay amount={row.average_payout} />
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </TabsContent>

            {/* Quarterly Summary Tab */}
            <TabsContent value="quarterly" className="mt-0">
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full">
                  <thead className="bg-muted/50">
                    <tr className="border-b">
                      <th className="text-left p-3 text-sm font-medium">Quarter</th>
                      <th className="text-left p-3 text-sm font-medium">Total Amount</th>
                      <th className="text-left p-3 text-sm font-medium">Total Payouts</th>
                      <th className="text-left p-3 text-sm font-medium">Average Payout</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quarterlyLoading ? (
                      <tr>
                        <td colSpan={4} className="p-12 text-center">
                          <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
                        </td>
                      </tr>
                    ) : quarterlyData.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="p-12 text-center text-muted-foreground">
                          <BarChart3 className="h-12 w-12 mx-auto mb-4 opacity-20" />
                          <p>No quarterly data available</p>
                        </td>
                      </tr>
                    ) : (
                      quarterlyData.map((row) => (
                        <tr key={row.quarter} className="border-b hover:bg-muted/20">
                          <td className="p-3 text-sm font-medium">{formatQuarter(row.quarter)}</td>
                          <td className="p-3 text-sm">
                            <MoneyDisplay amount={row.total_amount} />
                          </td>
                          <td className="p-3 text-sm">{row.total_payouts}</td>
                          <td className="p-3 text-sm">
                            <MoneyDisplay amount={row.average_payout} />
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Mark Paid Dialog */}
      <AlertDialog open={markPaidDialogOpen} onOpenChange={setMarkPaidDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark Payout as Paid?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>Are you sure you want to mark this payout as paid?</p>
                {payoutToMarkPaid && (
                  <div className="bg-muted p-3 rounded-md text-sm">
                    <p>
                      <strong>MID:</strong> {payoutToMarkPaid.mid}
                    </p>
                    <p>
                      <strong>Merchant:</strong> {payoutToMarkPaid.merchant_name}
                    </p>
                    <p>
                      <strong>Agent:</strong> {payoutToMarkPaid.partner_name || payoutToMarkPaid.partner_role}
                    </p>
                    <p>
                      <strong>Amount:</strong>{" "}
                      <MoneyDisplay amount={Number.parseFloat(payoutToMarkPaid.partner_payout_amount)} />
                    </p>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={markingPaid}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmMarkPaid} disabled={markingPaid}>
              {markingPaid ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Mass Payout Dialog */}
      <AlertDialog open={massPaidDialogOpen} onOpenChange={setMassPaidDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mass Mark as Paid?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to mark all payouts for {selectedAgents.size} selected agent(s) as paid? This will
              update all their unpaid payout records.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={massMarkingPaid}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmMassPaid} disabled={massMarkingPaid}>
              {massMarkingPaid ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Confirm Mass Payout
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
