import * as React from 'react'
import {
  receivablesStore,
  type UtangSale,
  type UtangPayment,
  type PersonLedgerSummary,
  type ReceivablesKPIs,
  type PaymentMethod,
  type CustomerType,
  type PaymentOption,
} from '@/services/receivablesStore'

export function useReceivables(
  dateRange?: { startDate?: string; endDate?: string },
  company?: string
) {
  const [sales, setSales] = React.useState<UtangSale[]>(() => receivablesStore.getSales(company))
  const [people, setPeople] = React.useState<PersonLedgerSummary[]>(() =>
    receivablesStore.getPeopleSummaries(company)
  )
  const [payments, setPayments] = React.useState<UtangPayment[]>(() =>
    receivablesStore.getAllPayments(company)
  )
  const [kpis, setKpis] = React.useState<ReceivablesKPIs>(() =>
    receivablesStore.getKPIs(dateRange, company)
  )

  const reload = React.useCallback(() => {
    setSales(receivablesStore.getSales(company))
    setPeople(receivablesStore.getPeopleSummaries(company))
    setPayments(receivablesStore.getAllPayments(company))
    setKpis(receivablesStore.getKPIs(dateRange, company))
  }, [dateRange?.startDate, dateRange?.endDate, company])

  React.useEffect(() => {
    reload()
    const unsubscribe = receivablesStore.subscribe(reload)
    return () => {
      unsubscribe()
    }
  }, [reload])

  const recordPayment = React.useCallback(
    (params: {
      customer_name: string
      amount: number
      date: string
      method: PaymentMethod
      sale_id?: string
      notes?: string
    }) => {
      return receivablesStore.recordPayment(params)
    },
    []
  )

  const settleStaffPayrollDeduction = React.useCallback(
    (customer_name: string, notes?: string) => {
      return receivablesStore.settleStaffPayrollDeduction(customer_name, notes)
    },
    []
  )

  const addNewSale = React.useCallback(
    (params: {
      customer_name: string
      customer_type: CustomerType
      customer_phone?: string
      customer_role?: string
      items_summary: string
      total_amount: number
      payment_option: PaymentOption
      amount_paid?: number
      payment_method?: PaymentMethod
      date?: string
      notes?: string
      company?: string
    }) => {
      return receivablesStore.addNewSale(params)
    },
    []
  )

  const resetToDefault = React.useCallback(() => {
    receivablesStore.resetToDefault()
  }, [])

  return {
    sales,
    people,
    payments,
    kpis,
    recordPayment,
    settleStaffPayrollDeduction,
    addNewSale,
    resetToDefault,
  }
}

