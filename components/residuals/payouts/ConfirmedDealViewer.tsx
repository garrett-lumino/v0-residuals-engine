"use client"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Plus, AlertCircle, Search, Trash2 } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { useToast } from "@/hooks/use-toast"
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
  deal_id?: string
  payout_type?: string
  is_held?: boolean
  hold_reason?: string
}

interface Partner {
  id: string
  name: string
  email: string
}

interface Deal {
  id: string
  deal_id: string
  mid: string
  payout_type: string
  participants_json: any[]
  effective_date?: string
}

interface ConfirmedDealViewerProps {
  event?: UnassignedEvent | null
  events?: UnassignedEvent[]
  isOpen?: boolean
  onClose?: () => void
  onComplete?: () => void
}

// Normalize participant data to use canonical field names
const normalizeParticipant = (p: any) => ({
  partner_airtable_id: p.partner_airtable_id || p.agent_id || p.partner_id || "",
  partner_name: p.partner_name || p.name || "",
  partner_role: p.partner_role || p.role || "Partner",
  partner_email: p.partner_email || p.email || "",
  split_pct: p.split_pct || 0,
})

// Check if participant is Lumino Company
const isLuminoCompany = (p: any) => {
  const id = p.partner_airtable_id || p.agent_id || p.partner_id
  return id === "lumino-company"
}

export function ConfirmedDealViewer({ event, events, isOpen = false, onClose, onComplete }: ConfirmedDealViewerProps) {
  const [partners, setPartners] = useState<Partner[]>([])
  const [deal, setDeal] = useState<Deal | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [isLuminoOverridden, setIsLuminoOverridden] = useState(false)
  const [participantSearchTerms, setParticipantSearchTerms] = useState<{ [key: number]: string }>({})
  const [participants, setParticipants] = useState<any[]>([])
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState("")
  const { toast } = useToast()

  // If used as a list view (events prop), just render null for now - this is handled by UnassignedQueue
  if (events && !event) {
    return null
  }

  useEffect(() => {
    if (isOpen && event) {
      fetchDealAndPartners()
    }
  }, [isOpen, event])

  const fetchDealAndPartners = async () => {
    if (!event) return
    setIsLoading(true)
    try {
      console.log("[v0] Fetching deal for confirmed event:", event.id)
      const dealResponse = await fetch(`/api/unassigned-events/${event.id}/deal`)
      console.log("[v0] Deal response status:", dealResponse.status)

      if (!dealResponse.ok) {
        const errorData = await dealResponse.json()
        console.error("[v0] Deal fetch failed:", errorData)
        toast({
          title: "Error",
          description: errorData.error || "Failed to load deal data",
          variant: "destructive",
        })
        return
      }

      const dealData = await dealResponse.json()
      console.log("[v0] Deal data received:", dealData)

      const partnersResponse = await fetch("/api/airtable-partners")
      const partnersData = await partnersResponse.json()

      setDeal(dealData.deal)
      setPartners(partnersData.partners || [])

      if (dealData.deal?.participants_json) {
        // Normalize all participants to use canonical field names
        const normalizedParticipants = dealData.deal.participants_json.map(normalizeParticipant)
        setParticipants(normalizedParticipants)
        const luminoParticipant = normalizedParticipants.find(isLuminoCompany)
        if (luminoParticipant) {
          const othersSplit = normalizedParticipants
            .filter((p: any) => !isLuminoCompany(p))
            .reduce((sum: number, p: any) => sum + (p.split_pct || 0), 0)
          setIsLuminoOverridden(luminoParticipant.split_pct !== 100 - othersSplit)
        }
      }
    } catch (error) {
      console.error("[v0] Error fetching deal and partners:", error)
      toast({
        title: "Error",
        description: "Failed to load deal data. Please try again.",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleSave = async () => {
    if (!deal) return

    if (participants.length === 0) {
      toast({
        title: "Validation Error",
        description: "You must have at least one participant",
        variant: "destructive",
      })
      return
    }

    const totalSplit = participants.reduce((sum, p) => sum + (p.split_pct || 0), 0)
    if (totalSplit !== 100) {
      toast({
        title: "Validation Error",
        description: "Split percentages must total 100%",
        variant: "destructive",
      })
      return
    }

    setIsLoading(true)
    try {
      console.log("[v0] Saving deal changes:", {
        dealId: deal.deal_id,
        participants: participants,
      })

      const response = await fetch(`/api/deals/${deal.deal_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participants_json: participants,
        }),
      })

      console.log("[v0] Save response status:", response.status)
      const responseData = await response.json()
      console.log("[v0] Save response data:", responseData)

      if (response.ok) {
        toast({
          title: "Success",
          description: "Deal updated successfully",
        })
        setDeal({ ...deal, participants_json: participants })
        setIsEditing(false)
        onComplete?.() // Notify parent to refresh
      } else {
        console.error("[v0] Failed to update deal:", responseData)
        toast({
          title: "Save Failed",
          description: responseData.error || "Failed to update deal. Please try again.",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("[v0] Error updating deal:", error)
      toast({
        title: "Error",
        description: "An unexpected error occurred. Please try again.",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!event) return
    if (deleteConfirmText !== "DELETE") {
      toast({
        title: "Confirmation Required",
        description: 'Please type "DELETE" to confirm',
        variant: "destructive",
      })
      return
    }

    setIsLoading(true)
    try {
      console.log("[v0] Deleting confirmed event:", event.id)

      // Use /delete endpoint which handles confirmed events (not the base endpoint which only handles unassigned/pending)
      // NOTE: Using POST because DELETE on /delete route was being caught by parent [id] route's DELETE handler
      const response = await fetch(`/api/unassigned-events/${event.id}/delete`, {
        method: "POST",
      })

      console.log("[v0] Delete response status:", response.status)

      if (response.ok) {
        toast({
          title: "Success",
          description: "Confirmed event deleted successfully",
        })
        setIsDeleteDialogOpen(false)
        onClose?.()
        onComplete?.()
      } else {
        const responseData = await response.json()
        console.error("[v0] Failed to delete event:", responseData)
        toast({
          title: "Deletion Failed",
          description: responseData.error || "Failed to delete event. Please try again.",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("[v0] Error deleting event:", error)
      toast({
        title: "Error",
        description: "An unexpected error occurred. Please try again.",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const addParticipant = () => {
    const luminoIndex = participants.findIndex(isLuminoCompany)
    const newParticipant = { partner_airtable_id: "", partner_name: "", partner_role: "Partner", partner_email: "", split_pct: 0 }

    if (luminoIndex !== -1) {
      const updatedParticipants = [...participants]
      updatedParticipants.splice(luminoIndex, 0, newParticipant)
      setParticipants(updatedParticipants)
    } else {
      setParticipants([...participants, newParticipant])
    }
  }

  const updateParticipant = (index: number, field: string, value: any) => {
    const updatedParticipants = participants.map((p, i) => (i === index ? { ...p, [field]: value } : p))

    if (field === "split_pct" && !isLuminoOverridden) {
      const luminoIndex = updatedParticipants.findIndex(isLuminoCompany)
      if (luminoIndex !== -1) {
        const participantsSplit = updatedParticipants
          .filter((p, i) => i !== luminoIndex)
          .reduce((sum, p) => sum + (p.split_pct || 0), 0)
        const luminoSplit = Math.max(0, 100 - participantsSplit)
        updatedParticipants[luminoIndex] = { ...updatedParticipants[luminoIndex], split_pct: luminoSplit }
      }
    }

    setParticipants(updatedParticipants)
  }

  const removeParticipant = (index: number) => {
    const participantToRemove = participants[index]
    const updatedParticipants = participants.filter((_, i) => i !== index)

    if (isLuminoCompany(participantToRemove)) {
      setIsLuminoOverridden(false)
    } else if (!isLuminoOverridden) {
      const luminoIndex = updatedParticipants.findIndex(isLuminoCompany)
      if (luminoIndex !== -1) {
        const participantsSplit = updatedParticipants
          .filter((p, i) => i !== luminoIndex)
          .reduce((sum, p) => sum + (p.split_pct || 0), 0)
        const luminoSplit = Math.max(0, 100 - participantsSplit)
        updatedParticipants[luminoIndex] = { ...updatedParticipants[luminoIndex], split_pct: luminoSplit }
      }
    }

    setParticipants(updatedParticipants)
  }

  const getFilteredPartnersForIndex = (index: number) => {
    const searchTerm = participantSearchTerms[index] || ""
    if (!searchTerm) {
      return partners
    }
    return partners.filter(
      (partner) =>
        partner.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        partner.email.toLowerCase().includes(searchTerm.toLowerCase()),
    )
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount)
  }

  const truncateText = (text: string, maxLength: number) => {
    if (text.length <= maxLength) return text
    return text.substring(0, maxLength) + "..."
  }

  const participantsSplit = participants
    .filter((p) => p.agent_id !== "lumino-company" && p.partner_id !== "lumino-company")
    .reduce((sum, p) => sum + (p.split_pct || 0), 0)

  const luminoParticipant = participants.find(
    (p) => p.agent_id === "lumino-company" || p.partner_id === "lumino-company",
  )
  const luminoSplit = luminoParticipant?.split_pct || 0
  const totalSplitPct = participantsSplit + luminoSplit
  const remainingSplit = Math.max(0, 100 - participantsSplit)

  const isValidSplit = totalSplitPct === 100
  const isOverAllocated = totalSplitPct > 100

  const getPayoutTypeLabel = (payout_type: string | undefined) => {
    if (!payout_type) return "Unknown"
    const typeLower = payout_type.toLowerCase()
    if (typeLower.includes("residual")) return "Residual"
    if (typeLower.includes("upfront")) return "Upfront"
    if (typeLower.includes("clawback")) return "Clawback"
    if (typeLower.includes("trueup")) return "Trueup"
    if (typeLower.includes("bonus")) return "Bonus"
    if (typeLower.includes("adjustment")) return "Adjustment"
    return payout_type
  }

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-h-[90vh] overflow-y-auto" style={{ width: "1200px", maxWidth: "85vw" }}>
          <DialogHeader>
            <DialogTitle>{isEditing ? "Edit Confirmed Deal" : "View Confirmed Deal"}</DialogTitle>
            <DialogDescription>
              {isEditing ? "Modify deal details and participants" : "Review confirmed deal information"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {/* Deal Information Card */}
            <Card>
              <CardContent className="pt-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <Label className="text-muted-foreground">MID</Label>
                    <p className="font-mono">{event?.mid || deal?.mid || "N/A"}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Merchant</Label>
                    <p>{event?.merchant_name || "N/A"}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Volume</Label>
                    <p>{formatCurrency(event?.volume || 0)}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Payout Amount</Label>
                    <p>{event?.is_held ? formatCurrency(0) : formatCurrency(event?.fees || 0)}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Payout Type</Label>
                    <Badge variant="outline" className="mt-1">
                      {getPayoutTypeLabel(event?.payout_type || deal?.payout_type)}
                    </Badge>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Deal ID</Label>
                    <p className="font-mono text-xs">{deal?.deal_id || "N/A"}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Batch ID</Label>
                    <p className="font-mono text-xs">{event?.batch_id || "N/A"}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Status</Label>
                    {event?.is_held ? (
                      <div className="flex flex-col gap-1">
                        <Badge variant="secondary" className="bg-orange-100 text-orange-800 w-fit">
                          on hold
                        </Badge>
                        {event.hold_reason && (
                          <span className="text-xs text-muted-foreground">{event.hold_reason}</span>
                        )}
                      </div>
                    ) : (
                      <Badge variant="default" className="bg-green-100 text-green-800 w-fit">
                        confirmed
                      </Badge>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Participants Card */}
            <Card>
              <CardContent className="pt-4 space-y-4">
                <div className="flex items-center justify-between">
                  <Label className="text-lg font-semibold">Participants ({participants.length})</Label>
                  {isEditing && (
                    <Button type="button" variant="outline" size="sm" onClick={addParticipant}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add Participant
                    </Button>
                  )}
                </div>

                {isOverAllocated && isEditing && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>Splits exceed 100%. Reduce allocations to continue.</AlertDescription>
                  </Alert>
                )}

                {participants.map((participant, index) => {
                  const isLumino = isLuminoCompany(participant)
                  const participantId = participant.partner_airtable_id
                  const selectedPartner = partners.find((p) => p.id === participantId)

                  return (
                    <Card key={index} className={isLumino ? "border-blue-200 bg-blue-50/30" : ""}>
                      <CardContent className="pt-4">
                        {isEditing ? (
                          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                            {isLumino ? (
                              <div className="lg:col-span-2">
                                <Label>Partner</Label>
                                <div className="p-3 bg-blue-100 border border-blue-300 rounded-md">
                                  <div className="font-medium text-sm text-blue-900">Lumino (Company)</div>
                                  <div className="text-blue-700 text-xs">company@lumino.com</div>
                                  <div className="text-blue-600 text-xs mt-1">
                                    {!isLuminoOverridden ? "Auto-calculated remainder" : "Manual override"}
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="lg:col-span-2 relative">
                                <Label>Partner</Label>
                                <Select
                                  value={participantId}
                                  onValueChange={(value) => {
                                    updateParticipant(index, "partner_airtable_id", value)
                                    // Also update partner_name and partner_email from selected partner
                                    const partner = partners.find((p) => p.id === value)
                                    if (partner) {
                                      updateParticipant(index, "partner_name", partner.name)
                                      updateParticipant(index, "partner_email", partner.email)
                                    }
                                    setParticipantSearchTerms((prev) => ({
                                      ...prev,
                                      [index]: "",
                                    }))
                                  }}
                                >
                                  <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Select partner">
                                      {participantId && (
                                        <span className="truncate">
                                          {(() => {
                                            if (participantId === "lumino-company") {
                                              return "Lumino (Company)"
                                            }
                                            return selectedPartner
                                              ? truncateText(`${selectedPartner.name} (${selectedPartner.email})`, 40)
                                              : participant.partner_name || participantId
                                          })()}
                                        </span>
                                      )}
                                    </SelectValue>
                                  </SelectTrigger>
                                  <SelectContent>
                                    <div className="p-2 border-b sticky top-0 bg-white z-10">
                                      <div className="relative">
                                        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                        <Input
                                          placeholder="Search partners..."
                                          value={participantSearchTerms[index] || ""}
                                          onChange={(e) => {
                                            setParticipantSearchTerms((prev) => ({
                                              ...prev,
                                              [index]: e.target.value,
                                            }))
                                          }}
                                          className="pl-8 h-9"
                                          onClick={(e) => e.stopPropagation()}
                                          onKeyDown={(e) => e.stopPropagation()}
                                        />
                                      </div>
                                    </div>
                                    <div className="max-h-[200px] overflow-y-auto">
                                      <SelectItem value="lumino-company">
                                        <div className="flex flex-col">
                                          <span className="font-medium">Lumino (Company)</span>
                                          <span className="text-xs text-muted-foreground">company@lumino.com</span>
                                        </div>
                                      </SelectItem>
                                      {(() => {
                                        const filteredPartners = getFilteredPartnersForIndex(index)
                                        return filteredPartners.length === 0 ? (
                                          <div className="p-2 text-sm text-muted-foreground text-center">
                                            {participantSearchTerms[index]
                                              ? "No partners found matching your search"
                                              : "No partners available"}
                                          </div>
                                        ) : (
                                          filteredPartners.map((partner) => (
                                            <SelectItem key={partner.id} value={partner.id}>
                                              <div className="flex flex-col">
                                                <span className="font-medium">{truncateText(partner.name, 25)}</span>
                                                <span className="text-xs text-muted-foreground">
                                                  {truncateText(partner.email, 30)}
                                                </span>
                                              </div>
                                            </SelectItem>
                                          ))
                                        )
                                      })()}
                                    </div>
                                  </SelectContent>
                                </Select>
                              </div>
                            )}

                            <div>
                              <Label>Role</Label>
                              <Select
                                value={participant.partner_role}
                                onValueChange={(value) => updateParticipant(index, "partner_role", value)}
                                disabled={isLumino}
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="Partner">Partner</SelectItem>
                                  <SelectItem value="Sales Rep">Sales Rep</SelectItem>
                                  <SelectItem value="Referral">Referral</SelectItem>
                                  <SelectItem value="ISO">ISO</SelectItem>
                                  <SelectItem value="Agent">Agent</SelectItem>
                                  <SelectItem value="Company">Company</SelectItem>
                                  <SelectItem value="Investor">Investor</SelectItem>
                                  <SelectItem value="Fund I">Fund I</SelectItem>
                                  <SelectItem value="Fund II">Fund II</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="flex flex-col space-y-2">
                              <div>
                                <Label>Split %</Label>
                                <Input
                                  type="number"
                                  min="0"
                                  max="100"
                                  value={participant.split_pct}
                                  onChange={(e) => {
                                    const value = Number.parseFloat(e.target.value) || 0
                                    updateParticipant(index, "split_pct", value)
                                    if (isLumino) {
                                      setIsLuminoOverridden(true)
                                    }
                                  }}
                                  className={isLumino ? "bg-blue-50 border-blue-200" : ""}
                                />
                                {isLumino && !isLuminoOverridden && (
                                  <p className="text-xs text-blue-600">Auto-calculated: {remainingSplit}% remaining</p>
                                )}
                              </div>
                              {participants.length > 1 && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => removeParticipant(index)}
                                  className="mt-auto"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </div>
                        ) : (
                          // View mode - read-only display
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                              <Label className="text-muted-foreground">Partner</Label>
                              <p className="font-medium">
                                {isLumino ? "Lumino (Company)" : participant.partner_name || (selectedPartner ? selectedPartner.name : participantId)}
                              </p>
                              {!isLumino && (participant.partner_email || selectedPartner?.email) && (
                                <p className="text-xs text-muted-foreground">{participant.partner_email || selectedPartner?.email}</p>
                              )}
                            </div>
                            <div>
                              <Label className="text-muted-foreground">Role</Label>
                              <Badge variant="outline">{participant.partner_role}</Badge>
                            </div>
                            <div>
                              <Label className="text-muted-foreground">Split</Label>
                              <p className="font-semibold">{participant.split_pct}%</p>
                              <p className="text-xs text-muted-foreground">
                                {formatCurrency((event?.fees || 0) * (participant.split_pct / 100))}
                              </p>
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )
                })}

                {isEditing && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span>Total Split Percentage:</span>
                      <div className="flex items-center gap-2">
                        <Badge variant={isValidSplit ? "default" : isOverAllocated ? "destructive" : "secondary"}>
                          {totalSplitPct}%
                        </Badge>
                        {!isValidSplit && !isOverAllocated && (
                          <Badge variant="outline" className="text-orange-600">
                            {100 - totalSplitPct}% remaining
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="flex justify-between pt-4 border-t">
            <Button variant="destructive" onClick={() => setIsDeleteDialogOpen(true)} disabled={isLoading}>
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Deal
            </Button>
            <div className="flex gap-2">
              {isEditing ? (
                <>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsEditing(false)
                      fetchDealAndPartners() // Reset to original data
                    }}
                  >
                    Cancel
                  </Button>
                  <Button onClick={handleSave} disabled={!isValidSplit || isLoading || participants.length === 0}>
                    {isLoading ? "Saving..." : "Save Changes"}
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" onClick={onClose}>
                    Close
                  </Button>
                  <Button onClick={() => setIsEditing(true)}>Edit Deal</Button>
                </>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Confirmed Deal</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the confirmed deal and all associated data.
              <br />
              <br />
              Type <strong>DELETE</strong> to confirm:
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
            placeholder="Type DELETE to confirm"
            className="mt-2"
          />
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteConfirmText("")}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault() // Prevent dialog from closing before async operation completes
                handleDelete()
              }}
              disabled={deleteConfirmText !== "DELETE" || isLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isLoading ? "Deleting..." : "Delete Deal"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
