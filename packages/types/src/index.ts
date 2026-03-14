export type UserRole = 'admin' | 'staff'
export type WarehouseType = 'main' | 'partner' | 'other'
export type AttributeInputType = 'select' | 'text' | 'number'
export type LedgerActionType = 'receive' | 'transfer_in' | 'transfer_out' | 'sale' | 'return' | 'adjustment'
export type SaleType = 'direct' | 'partner' | 'woocommerce'
export type FulfillmentState = 'draft' | 'prepared' | 'shipped' | 'delivered' | 'cancelled' | 'returned'
export type PaymentState = 'unpaid' | 'paid' | 'refunded'
export type InvoiceState = 'pending' | 'invoice_created' | 'tax_invoice_created' | 'credited' | 'not_required'

export interface AuthUser {
  id: string
  email: string
  name: string
  role: UserRole
}

export interface LoginRequest {
  email: string
  password: string
}

export interface LoginResponse {
  accessToken: string
  user: AuthUser
}

export interface WarehouseDTO {
  id: string
  name: string
  type: WarehouseType
  isActive: boolean
  notes: string | null
  color: string
  icon: string
  logo: string | null
  createdAt: string
  stockCount?: number
}

export interface CreateWarehouseRequest {
  name: string
  type: WarehouseType
  notes?: string
}

export interface StockItemDTO {
  productId:     string
  sku:           string
  name:          string | null
  quantity:      number
  updatedAt:     string
  boxNumber:     string | null
  dateAdded:     string | null
  // display names
  brand:         string | null
  category:      string | null
  model:         string | null
  size:          string | null
  color:         string | null
  unit:          string | null
  // FK / option IDs — populated so edit forms can pre-select values
  brandId:       string | null
  categoryId:    string | null
  sizeOptionId:  string | null
  colorOptionId: string | null
  unitOptionId:  string | null
  // WooCommerce display title (how the product name appears on the WC website)
  wooTitle:      string | null
  // product image stored as a resized base64 data URL
  image:         string | null
  // pricing
  costPrice:     string | null
  retailPrice:   string | null
}

export interface ApiError {
  error: string
  code: string
  details?: unknown
}
