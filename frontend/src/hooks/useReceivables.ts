import * as React from 'react'
import {
  receivablesStore,
  type UtangSale,
  type UtangPayment,
  type PersonLedgerSummary,
  type ReceivablesKPIs,
  type PaymentMethod,
  type PaymentStatus,
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
      company?: string
      company_id?: number
      bank_account_id?: string
      notes?: string
    }) => {
      return receivablesStore.recordPayment(params)
    },
    []
  )

  const settleStaffPayrollDeduction = React.useCallback(
    (customer_name: string, notes?: string, company_id?: number, targetCompany?: string) => {
      return receivablesStore.settleStaffPayrollDeduction(
        customer_name,
        notes,
        company_id,
        targetCompany ?? company
      )
    },
    [company]
  )

  const addNewSale = React.useCallback(
    (params: {
      customer_name: string
      customer_type: CustomerType
      items_summary: string
      total_amount: number
      payment_option: PaymentOption
      amount_paid?: number
      payment_method?: PaymentMethod
      bank_account_id?: string
      date?: string
      notes?: string
      company?: string
      company_id?: number
      sale_id?: number
      sale_line_index?: number
      expense_id?: number
    }) => {
      return receivablesStore.addNewSale(params)
    },
    []
  )

  const editSale = React.useCallback(
    (
      saleId: string,
      params: {
        customer_name?: string
        customer_type?: CustomerType
        items_summary?: string
        total_amount?: number
        notes?: string
        date?: string
        payment_status?: PaymentStatus
        payment_method?: string
        bank_account_id?: string
        deposit_status?: 'Deposited' | 'Not Deposited'
        deposit_date?: string
      }
    ) => {
      return receivablesStore.editSale(saleId, params)
    },
    []
  )

  const updateDebtor = React.useCallback(
    (params: {
      old_customer_name: string
      new_customer_name: string
      customer_type: CustomerType
      company?: string
      company_id?: number
    }) => {
      return receivablesStore.updateDebtor(params)
    },
    []
  )

  const deleteDebtor = React.useCallback(
    (params: {
      customer_name: string
      company?: string
      company_id?: number
    }) => {
      return receivablesStore.deleteDebtor(params)
    },
    []
  )

  const deleteSale = React.useCallback((saleId: string) => {
    return receivablesStore.deleteSale(saleId)
  }, [])

  const deletePayment = React.useCallback((paymentId: string) => {
    return receivablesStore.deletePayment(paymentId)
  }, [])

  const refreshFromBackend = React.useCallback(() => {
    return receivablesStore.refreshFromBackend()
  }, [])

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
    editSale,
    updateDebtor,
    deleteDebtor,
    deleteSale,
    deletePayment,
    refresh: reload,
    refreshFromBackend,
    resetToDefault,
  }
}
