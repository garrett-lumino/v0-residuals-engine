import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { MoneyDisplay } from "@/components/residuals/shared/MoneyDisplay"
import { Button } from "@/components/ui/button"
import { Upload, CheckCircle2, FileText, TrendingUp } from "lucide-react"
import Link from "next/link"
import { createClient } from "@/lib/db/server"
import { formatPayoutMonth } from "@/lib/utils/formatters"

async function getDashboardStats() {
  const supabase = await createClient()

  // Get total count of all payouts
  const { count: totalPayoutsCount } = await supabase.from("payouts").select("*", { count: "exact", head: true })

  // Get confirmed payouts count
  const { count: confirmedCount } = await supabase
    .from("payouts")
    .select("*", { count: "exact", head: true })
    .eq("assignment_status", "confirmed")

  // Get paid payouts count
  const { count: paidCount } = await supabase
    .from("payouts")
    .select("*", { count: "exact", head: true })
    .eq("paid_status", "paid")

  // For aggregations, we still need to fetch data but with a reasonable limit
  const { data: payouts } = await supabase
    .from("payouts")
    .select("volume, partner_payout_amount, paid_status")
    .limit(10000)

  const totalVolume = payouts?.reduce((sum, p) => sum + (Number.parseFloat(p.volume) || 0), 0) || 0
  const totalPayouts = payouts?.reduce((sum, p) => sum + (Number.parseFloat(p.partner_payout_amount) || 0), 0) || 0
  const paidPayouts = payouts?.filter((p) => p.paid_status === "paid") || []
  const paidAmount = paidPayouts.reduce((sum, p) => sum + (Number.parseFloat(p.partner_payout_amount) || 0), 0)

  const confirmedPct = totalPayoutsCount ? Math.round(((confirmedCount || 0) / totalPayoutsCount) * 100) : 0

  const payoutPct = totalVolume ? ((totalPayouts / totalVolume) * 100).toFixed(2) : "0.00"

  // Get active deals
  const { count: activeDeals } = await supabase.from("deals").select("*", { count: "exact", head: true })

  const { data: merchantData } = await supabase.from("payouts").select("merchant_name, mid, volume").limit(10000)

  const merchantVolumes = new Map<string, { name: string; volume: number }>()
  merchantData?.forEach((p) => {
    const existing = merchantVolumes.get(p.mid) || { name: p.merchant_name, volume: 0 }
    existing.volume += Number.parseFloat(p.volume) || 0
    merchantVolumes.set(p.mid, existing)
  })

  const topMerchants = Array.from(merchantVolumes.values())
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 5)

  const { data: recentUploads } = await supabase
    .from("csv_data")
    .select("id, payout_month, created_at")
    .order("created_at", { ascending: false })
    .limit(10)

  // Group by payout_month to get batches
  const uploadBatches = new Map<string, { month: string; count: number; date: string }>()
  recentUploads?.forEach((upload) => {
    const key = upload.payout_month
    const existing = uploadBatches.get(key) || { month: upload.payout_month, count: 0, date: upload.created_at }
    existing.count++
    uploadBatches.set(key, existing)
  })

  const uploads = Array.from(uploadBatches.values()).slice(0, 3)

  return {
    totalVolume,
    totalPayouts,
    paidAmount,
    paidCount: paidCount || 0,
    confirmedCount: confirmedCount || 0,
    totalPayoutsCount: totalPayoutsCount || 0,
    confirmedPct,
    payoutPct,
    activeDeals: activeDeals || 0,
    topMerchants,
    uploads,
  }
}

export default async function DashboardPage() {
  const stats = await getDashboardStats()

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">Welcome back, Andrew</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/residuals/upload">
            <Button>
              <Upload className="mr-2 h-4 w-4" />
              Upload CSVs
            </Button>
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Volume</CardTitle>
            <div className="text-xs text-muted-foreground">$</div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              <MoneyDisplay amount={stats.totalVolume} />
            </div>
            <p className="text-xs text-muted-foreground">{stats.totalPayoutsCount} transactions</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Payouts</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              <MoneyDisplay amount={stats.totalPayouts} />
            </div>
            <p className="text-xs text-muted-foreground">{stats.payoutPct}% of volume</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Confirmed Payouts</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.confirmedCount}</div>
            <p className="text-xs text-muted-foreground">
              {stats.confirmedPct}% of {stats.totalPayoutsCount}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Deals</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.activeDeals}</div>
            <p className="text-xs text-muted-foreground">Ready for processing</p>
          </CardContent>
        </Card>
      </div>

      {/* Processing Progress */}
      <Card>
        <CardHeader>
          <CardTitle>Processing Progress</CardTitle>
          <CardDescription>Payout confirmation status</CardDescription>
        </CardHeader>
        <CardContent className="space-y-8">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <div className="font-medium">Unconfirmed</div>
              <div className="text-muted-foreground">
                {stats.totalPayoutsCount - stats.confirmedCount} ({100 - stats.confirmedPct}%)
              </div>
            </div>
            <div className="h-2 w-full rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-red-500 transition-all"
                style={{ width: `${Math.max(5, 100 - stats.confirmedPct)}%` }}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <div className="font-medium">Confirmed</div>
              <div className="text-muted-foreground">
                {stats.confirmedCount} ({stats.confirmedPct}%)
              </div>
            </div>
            <div className="h-2 w-full rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-green-500 transition-all"
                style={{ width: `${Math.max(5, stats.confirmedPct)}%` }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top Merchants</CardTitle>
            <CardDescription>Highest volume merchants</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.topMerchants.length > 0 ? (
              <div className="space-y-4">
                {stats.topMerchants.map((merchant, idx) => (
                  <div key={`${merchant.name}-${idx}`} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold">
                        {idx + 1}
                      </div>
                      <div>
                        <div className="text-sm font-medium">{merchant.name}</div>
                      </div>
                    </div>
                    <div className="text-sm font-medium">
                      <MoneyDisplay amount={merchant.volume} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center h-[200px] text-muted-foreground border-dashed border-2 rounded-lg">
                No merchant data available
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Uploads</CardTitle>
            <CardDescription>Latest CSV batches</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.uploads.length > 0 ? (
              <div className="space-y-4">
                {stats.uploads.map((upload, idx) => (
                  <div key={idx} className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="h-9 w-9 rounded bg-primary/10 flex items-center justify-center">
                        <FileText className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <div className="text-sm font-medium">
                          {formatPayoutMonth(upload.month)} • {upload.count} files
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(upload.date).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                    <div className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                      completed
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center h-[200px] text-muted-foreground border-dashed border-2 rounded-lg">
                No uploads yet
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
