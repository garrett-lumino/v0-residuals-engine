"use client"

import { useState, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import { Trash2, Plus, AlertTriangle, Check, ChevronsUpDown, Loader2, RotateCcw } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

interface Participant {
  partner_airtable_id?: string
  partner_name: string
  partner_role?: string
  split_pct: number
  partner_email?: string
  agent_id?: string
  agent_name?: string
  agent_email?: string
  airtable_record_id?: string
  // Legacy fields for backward compatibility
  partner_id?: string
  role?: string
  airtable_id?: string
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
  participants_json: Participant[]
}

interface Event {
  id: string
  mid: string | null
  merchant_name: string | null
  volume: number
  payout_amount?: number
  fees?: number
  payout_type?: string
  assignment_status?: string
  deal_id?: string | null
}

interface EditPendingDealModalProps {
  event: Event
  isOpen: boolean
  onClose: () => void
  onComplete: () => void
}

export function EditPendingDealModal({ event, isOpen, onClose, onComplete }: EditPendingDealModalProps) {
  const { toast } = useToast()
  const [deal, setDeal] = useState<Deal | null>(null)
  const [partners, setPartners] = useState<Partner[]>([])
  const [participants, setParticipants] = useState<Participant[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [dealMissing, setDealMissing] = useState(false)
  const [openPopovers, setOpenPopovers] = useState<Record<number, boolean>>({})
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  useEffect(() => {
    if (isOpen && event) {
      setDealMissing(false)
      setOpenPopovers({})
      fetchDealAndPartners()
    }
  }, [isOpen, event])

  const fetchDealAndPartners = async () => {
    setIsLoading(true)
    try {
      console.log("[v0] Fetching deal for event:", event.id)
      const dealResponse = await fetch(`/api/unassigned-events/${event.id}/deal`)
      console.log("[v0] Deal response status:", dealResponse.status)

      if (dealResponse.status === 404) {
        console.log("[v0] No deal exists for this event yet")
        setDealMissing(true)
        const partnersResponse = await fetch("/api/airtable-partners")
        const partnersData = await partnersResponse.json()
        setPartners(partnersData.partners || [])
        setIsLoading(false)
        return
      }

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
        const mappedParticipants = dealData.deal.participants_json.map((p: any) => ({
          partner_airtable_id: p.partner_airtable_id || p.agent_id || p.airtable_record_id || "",
          partner_name: p.partner_name || p.agent_name || "",
          partner_email: p.partner_email || p.agent_email || "",
          partner_role: p.partner_role || p.role || "Partner",
          split_pct: Number(p.split_pct) || 0,
        }))
        setParticipants(mappedParticipants)
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

  const selectPartner = (index: number, partner: Partner) => {
    setParticipants((prev) =>
      prev.map((p, i) =>
        i === index
          ? {
              ...p,
              partner_airtable_id: partner.id,
              partner_name: partner.name,
              partner_email: partner.email,
            }
          : p,
      ),
    )
    setOpenPopovers((prev) => ({ ...prev, [index]: false }))
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
      const response = await fetch(`/api/deals/${deal.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participants: participants,
        }),
      })

      const responseData = await response.json()

      if (response.ok) {
        toast({
          title: "Success",
          description: "Assignment updated successfully",
        })
        onClose()
        onComplete()
      } else {
        toast({
          title: "Save Failed",
          description: responseData.error || "Failed to update deal. Please try again.",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("[v0] Error saving deal:", error)
      toast({
        title: "Error",
        description: "An error occurred while saving. Please try again.",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleReject = async () => {
    if (!deal) return

    console.log("[v0] handleReject - deal object:", { id: deal.id, deal_id: deal.deal_id })

    setIsLoading(true)
    try {
      const response = await fetch(`/api/deals/${deal.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: event.id }),
      })

      if (response.ok) {
        toast({
          title: "Assignment Undone",
          description: "The event has been returned to the unassigned queue",
        })
        onClose()
        onComplete()
      } else {
        const data = await response.json()
        toast({
          title: "Undo Failed",
          description: data.error || "Failed to undo assignment",
          variant: "destructive",
        })
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "An error occurred while undoing. Please try again.",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  /**
   * Reset an orphaned event (pending_confirmation without a deal) back to unassigned
   */
  const handleResetToUnassigned = async () => {
    setIsLoading(true)
    try {
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

      if (response.ok) {
        toast({
          title: "Event Reset",
          description: "The event has been returned to the unassigned queue",
        })
        onClose()
        onComplete()
      } else {
        const data = await response.json()
        toast({
          title: "Reset Failed",
          description: data.error || "Failed to reset event",
          variant: "destructive",
        })
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "An error occurred while resetting. Please try again.",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleDelete = async () => {
    setIsLoading(true)
    try {
      const response = await fetch(`/api/unassigned-events/${event.id}/delete`, {
        method: "DELETE",
      })

      if (response.ok) {
        toast({
          title: "Event Deleted",
          description: "The event has been permanently deleted (logged in history for recovery)",
        })
        onClose()
        onComplete()
      } else {
        const data = await response.json()
        toast({
          title: "Deletion Failed",
          description: data.error || "Failed to delete event",
          variant: "destructive",
        })
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "An error occurred while deleting. Please try again.",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
      setShowDeleteConfirm(false)
    }
  }

  const addParticipant = () => {
    setParticipants([
      ...participants,
      {
        partner_airtable_id: "",
        partner_name: "",
        partner_role: "Partner",
        split_pct: 0,
      },
    ])
  }

  const removeParticipant = (index: number) => {
    const participant = participants[index]
    const isLumino = participant.partner_airtable_id === "lumino-company"
    if (isLumino) {
      toast({
        title: "Cannot Remove",
        description: "Lumino (Company) cannot be removed. Set split to 0% instead.",
        variant: "destructive",
      })
      return
    }
    setParticipants(participants.filter((_, i) => i !== index))
  }

  const updateParticipant = (index: number, field: string, value: string | number) => {
    setParticipants((prev) => prev.map((p, i) => (i === index ? { ...p, [field]: value } : p)))
  }

  const calculateAmount = (splitPct: number) => {
    const fees = event.fees || event.payout_amount || 0
    return (fees * splitPct) / 100
  }

  const totalSplitPct = participants.reduce((sum, p) => sum + (p.split_pct || 0), 0)
  const payoutAmount = event.fees || event.payout_amount || 0

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[900px] max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>Edit Pending Assignment</DialogTitle>
          <DialogDescription>Modify participants before confirming this assignment</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-4">
          {/* Event Details Card */}
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm font-medium">Event Details</CardTitle>
            </CardHeader>
            <CardContent className="py-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">MID</p>
                  <p className="font-medium">{event.mid}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Merchant</p>
                  <p className="font-medium">{event.merchant_name}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Volume</p>
                  <p className="font-medium">${event.volume?.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Fees (Payout Amount)</p>
                  <p className="font-medium text-green-600">${payoutAmount?.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Payout Type</p>
                  <p className="font-medium">{event.payout_type || "N/A"}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {dealMissing ? (
            <Card className="border-destructive">
              <CardContent className="py-6">
                <div className="flex flex-col items-center justify-center text-center space-y-4">
                  <AlertTriangle className="h-12 w-12 text-destructive" />
                  <div>
                    <h3 className="font-semibold text-lg">No Deal Found</h3>
                    <p className="text-muted-foreground mt-1">
                      This event is marked as pending confirmation but doesn't have an associated deal.
                    </p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Click "Reset to Unassigned" below to return this event to the unassigned queue.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : isLoading ? (
            <Card>
              <CardContent className="py-6">
                <div className="flex items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  <span className="ml-2">Loading deal data...</span>
                </div>
              </CardContent>
            </Card>
          ) : (
            /* Participants Card */
            <Card>
              <CardHeader className="py-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium">Participants/Splits</CardTitle>
                  <Button variant="outline" size="sm" onClick={addParticipant}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add Participant
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="py-3 space-y-3">
                {participants.length === 0 ? (
                  <p className="text-center text-muted-foreground py-4">
                    No participants assigned yet. Click "Add Participant" to get started.
                  </p>
                ) : (
                  participants.map((participant, index) => (
                    <Card key={index} className="p-4">
                      <div className="grid grid-cols-12 gap-3 items-start">
                        <div className="col-span-5 space-y-1">
                          <Label className="text-xs">Partner</Label>
                          <Popover
                            open={openPopovers[index] || false}
                            onOpenChange={(isOpen) => setOpenPopovers((prev) => ({ ...prev, [index]: isOpen }))}
                          >
                            <PopoverTrigger asChild>
                              <Button
                                variant="outline"
                                role="combobox"
                                className="w-full justify-between h-10 font-normal bg-transparent"
                              >
                                {participant.partner_name
                                  ? `${participant.partner_name}${participant.partner_email ? ` (${participant.partner_email})` : ""}`
                                  : "Select partner..."}
                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[400px] p-0" align="start">
                              <Command>
                                <CommandInput placeholder="Search partners..." />
                                <CommandList>
                                  <CommandEmpty>No partners found.</CommandEmpty>
                                  <CommandGroup>
                                    {partners.map((partner) => (
                                      <CommandItem
                                        key={partner.id}
                                        value={`${partner.name} ${partner.email}`}
                                        onSelect={() => selectPartner(index, partner)}
                                      >
                                        <Check
                                          className={cn(
                                            "mr-2 h-4 w-4",
                                            participant.partner_airtable_id === partner.id
                                              ? "opacity-100"
                                              : "opacity-0",
                                          )}
                                        />
                                        <div className="flex flex-col">
                                          <span className="font-medium">{partner.name}</span>
                                          <span className="text-xs text-muted-foreground">
                                            {partner.email || "No email"} • ID: {partner.id.slice(0, 10)}...
                                          </span>
                                        </div>
                                      </CommandItem>
                                    ))}
                                  </CommandGroup>
                                </CommandList>
                              </Command>
                            </PopoverContent>
                          </Popover>
                          {participant.partner_airtable_id && (
                            <div className="text-xs text-muted-foreground font-mono mt-1">
                              Airtable ID: {participant.partner_airtable_id}
                            </div>
                          )}
                        </div>

                        <div className="col-span-2 space-y-1">
                          <Label className="text-xs">Role</Label>
                          <Select
                            value={participant.partner_role || "Partner"}
                            onValueChange={(value) => updateParticipant(index, "partner_role", value)}
                          >
                            <SelectTrigger className="h-10">
                              <SelectValue />
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

                        {/* Split % */}
                        <div className="col-span-2 space-y-1">
                          <Label className="text-xs">Split %</Label>
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            value={participant.split_pct}
                            onChange={(e) => updateParticipant(index, "split_pct", Number(e.target.value))}
                            className="h-10"
                          />
                        </div>

                        {/* Amount */}
                        <div className="col-span-2 space-y-1">
                          <Label className="text-xs">Amount</Label>
                          <div className="h-10 px-3 py-2 border rounded-md bg-muted flex items-center font-mono text-sm">
                            ${calculateAmount(participant.split_pct).toFixed(2)}
                          </div>
                        </div>

                        {/* Delete */}
                        <div className="col-span-1 flex items-end justify-end pb-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeParticipant(index)}
                            className="h-10 w-10 text-destructive hover:text-destructive"
                            disabled={participant.partner_airtable_id === "lumino-company"}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </Card>
                  ))
                )}

                {/* Total */}
                <Card className={cn("mt-4", totalSplitPct === 100 ? "border-green-500" : "border-destructive")}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-sm font-semibold">Total Split</Label>
                        <p className="text-xs text-muted-foreground">Must equal 100%</p>
                      </div>
                      <div
                        className={cn(
                          "text-2xl font-bold",
                          totalSplitPct === 100 ? "text-green-600" : "text-destructive",
                        )}
                      >
                        {totalSplitPct}%
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </CardContent>
            </Card>
          )}
        </div>

        <DialogFooter className="flex justify-between sm:justify-between">
          {!dealMissing && (
            <>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={handleReject}
                  disabled={isLoading || !deal}
                  className="gap-2 border-orange-500 text-orange-600 hover:bg-orange-50 bg-transparent"
                >
                  <RotateCcw className="h-4 w-4" />
                  Undo Assignment
                </Button>
                <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" disabled={isLoading} className="gap-2">
                      <Trash2 className="h-4 w-4" />
                      Delete Permanently
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete Event Permanently?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete the event for <strong>{event.merchant_name}</strong> (MID:{" "}
                        {event.mid}).
                        <br />
                        <br />
                        The data will be saved in the history logs for potential recovery, but the event will be removed
                        from all queues.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleDelete}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Yes, Delete Permanently
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={onClose} disabled={isLoading}>
                  Cancel
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={isLoading || !deal || totalSplitPct !== 100}
                  className="bg-green-600 hover:bg-green-700 text-white"
                >
                  {isLoading ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </>
          )}
          {dealMissing && (
            <div className="flex justify-between w-full">
              <Button
                variant="outline"
                onClick={handleResetToUnassigned}
                disabled={isLoading}
                className="gap-2 border-orange-500 text-orange-600 hover:bg-orange-50 bg-transparent"
              >
                <RotateCcw className="h-4 w-4" />
                Reset to Unassigned
              </Button>
              <Button variant="outline" onClick={onClose} disabled={isLoading}>
                Close
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
