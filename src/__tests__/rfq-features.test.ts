import { addProduct, removeProduct, updateProduct, validateProducts, calculateTotalQuantity, formatProductsForDisplay, Product } from '../utils/rfq-products'
import { calculateOfferTotal, validateOfferBatches, formatOfferSummary, DeliveryBatch } from '../utils/offer-utils'
import { filterRfqsByDeadline, filterRfqsByCategory, filterRfqsByCity, sortRfqsByDate, Rfq } from '../utils/rfq-filters'
import { formatInquiryTimestamp, isInquiryReplied, getInquiryStatus, Inquiry } from '../utils/inquiry-utils'

describe('RFQ Products Utility Functions', () => {
  describe('addProduct', () => {
    it('should add a new product to empty array', () => {
      const products: Product[] = []
      const result = addProduct(products)
      expect(result.length).toBe(1)
      expect(result[0]).toHaveProperty('id')
      expect(result[0].name).toBe('')
    })

    it('should add a new product to existing array', () => {
      const products: Product[] = [{ id: '1', name: 'حديد', quantity: '10', unit: 'طن', description: '' }]
      const result = addProduct(products)
      expect(result.length).toBe(2)
    })
  })

  describe('removeProduct', () => {
    it('should remove product by id', () => {
      const products: Product[] = [
        { id: '1', name: 'حديد', quantity: '10', unit: 'طن', description: '' },
        { id: '2', name: 'شبك', quantity: '5', unit: 'متر', description: '' }
      ]
      const result = removeProduct(products, '1')
      expect(result.length).toBe(1)
      expect(result[0].id).toBe('2')
    })

    it('should return same array if only one product', () => {
      const products: Product[] = [{ id: '1', name: 'حديد', quantity: '10', unit: 'طن', description: '' }]
      const result = removeProduct(products, '1')
      expect(result.length).toBe(1)
    })
  })

  describe('updateProduct', () => {
    it('should update specific field of a product', () => {
      const products: Product[] = [{ id: '1', name: 'حديد', quantity: '10', unit: 'طن', description: '' }]
      const result = updateProduct(products, '1', 'name', 'صاج')
      expect(result[0].name).toBe('صاج')
    })
  })

  describe('validateProducts', () => {
    it('should return valid for complete products', () => {
      const products: Product[] = [
        { id: '1', name: 'حديد', quantity: '10', unit: 'طن', description: '' }
      ]
      const result = validateProducts(products)
      expect(result.isValid).toBe(true)
      expect(result.validProducts.length).toBe(1)
    })

    it('should return invalid for empty products', () => {
      const products: Product[] = []
      const result = validateProducts(products)
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('يجب إضافة منتج واحد على الأقل')
    })

    it('should filter out incomplete products', () => {
      const products: Product[] = [
        { id: '1', name: 'حديد', quantity: '10', unit: 'طن', description: '' },
        { id: '2', name: '', quantity: '', unit: '', description: '' }
      ]
      const result = validateProducts(products)
      expect(result.isValid).toBe(true)
      expect(result.validProducts.length).toBe(1)
    })
  })

  describe('calculateTotalQuantity', () => {
    it('should calculate total quantity across products', () => {
      const products: Product[] = [
        { id: '1', name: 'حديد', quantity: '10', unit: 'طن', description: '' },
        { id: '2', name: 'شبك', quantity: '5', unit: 'متر', description: '' }
      ]
      const result = calculateTotalQuantity(products)
      expect(result.total).toBe(15)
    })
  })

  describe('formatProductsForDisplay', () => {
    it('should format products for display', () => {
      const products: Product[] = [
        { id: '1', name: 'حديد تسليح', quantity: '100', unit: 'طن', description: 'حديد سابك' }
      ]
      const result = formatProductsForDisplay(products)
      expect(result).toContain('حديد تسليح')
      expect(result).toContain('100 طن')
    })
  })
})

describe('Offer Utility Functions', () => {
  describe('calculateOfferTotal', () => {
    it('should calculate total from batches', () => {
      const batches = [
        { location: 'الرياض', deliveryDate: '2026-06-15', price: '25000' },
        { location: 'جدة', deliveryDate: '2026-06-20', price: '25000' }
      ]
      const result = calculateOfferTotal(batches)
      expect(result).toBe(50000)
    })

    it('should return 0 for empty batches', () => {
      const batches: DeliveryBatch[] = []
      const result = calculateOfferTotal(batches)
      expect(result).toBe(0)
    })
  })

  describe('validateOfferBatches', () => {
    it('should validate complete batches', () => {
      const batches: DeliveryBatch[] = [
        { location: 'الرياض', deliveryDate: '2026-06-15', price: '25000' }
      ]
      const result = validateOfferBatches(batches)
      expect(result.isValid).toBe(true)
    })

    it('should reject incomplete batches', () => {
      const batches: DeliveryBatch[] = [
        { location: '', deliveryDate: '2026-06-15', price: '25000' }
      ]
      const result = validateOfferBatches(batches)
      expect(result.isValid).toBe(false)
    })
  })

  describe('formatOfferSummary', () => {
    it('should format offer summary correctly', () => {
      const offer = {
        price: 50000,
        deliveryMethod: 'شاحنات خاصة',
        deliveryFrequency: 'دفعة واحدة',
        isFreeShipping: true,
        includesSample: true
      }
      const result = formatOfferSummary(offer)
      expect(result).toContain('شاحنات خاصة')
      expect(result).toContain('توصيل مجاني')
      expect(result).toContain('يتضمن عينة')
    })
  })
})

describe('RFQ Filter Functions', () => {
  const mockRfqs = [
    { id: '1', title: 'توريد حديد', category: 'حديد ومعادن', city: 'الرياض', deadline: '2026-06-15', createdAt: '2026-05-01' },
    { id: '2', title: 'توريد أسمنت', category: 'أسمنت وخرسانة', city: 'جدة', deadline: '2026-07-01', createdAt: '2026-05-02' },
    { id: '3', title: 'توريد طوب', category: 'طوب وبلوك', city: 'الدمام', deadline: '2026-05-20', createdAt: '2026-05-03' }
  ]

  describe('filterRfqsByDeadline', () => {
    it('should return all when filter is all', () => {
      const result = filterRfqsByDeadline(mockRfqs, 'all')
      expect(result.length).toBe(3)
    })

    it('should return future deadlines for week filter', () => {
      const rfqsWithNearDeadlines = [
        { id: '1', title: 'test', category: 'cat', city: 'city', deadline: '2026-05-06', createdAt: '2026-05-01' },
        { id: '2', title: 'test', category: 'cat', city: 'city', deadline: '2026-05-07', createdAt: '2026-05-01' },
        { id: '3', title: 'test', category: 'cat', city: 'city', deadline: '2026-06-01', createdAt: '2026-05-01' }
      ]
      const now = '2026-05-05'
      const result = filterRfqsByDeadline(rfqsWithNearDeadlines, 'week', now)
      expect(result.length).toBe(2)
    })
  })

  describe('filterRfqsByCategory', () => {
    it('should filter by specific category', () => {
      const result = filterRfqsByCategory(mockRfqs, 'حديد ومعادن')
      expect(result.length).toBe(1)
      expect(result[0].category).toBe('حديد ومعادن')
    })

    it('should return all when category is all', () => {
      const result = filterRfqsByCategory(mockRfqs, 'all')
      expect(result.length).toBe(3)
    })
  })

  describe('filterRfqsByCity', () => {
    it('should filter by specific city', () => {
      const result = filterRfqsByCity(mockRfqs, 'الرياض')
      expect(result.length).toBe(1)
      expect(result[0].city).toBe('الرياض')
    })

    it('should return all when city is all', () => {
      const result = filterRfqsByCity(mockRfqs, 'all')
      expect(result.length).toBe(3)
    })
  })

  describe('sortRfqsByDate', () => {
    it('should sort by createdAt descending', () => {
      const result = sortRfqsByDate(mockRfqs, 'desc')
      expect(result[0].id).toBe('3')
      expect(result[2].id).toBe('1')
    })

    it('should sort by createdAt ascending', () => {
      const result = sortRfqsByDate(mockRfqs, 'asc')
      expect(result[0].id).toBe('1')
      expect(result[2].id).toBe('3')
    })
  })
})

describe('Inquiry Utility Functions', () => {
  describe('formatInquiryTimestamp', () => {
    it('should format timestamp correctly', () => {
      const timestamp = '2026-05-05T10:30:00.000Z'
      const result = formatInquiryTimestamp(timestamp, 'ar-SA')
      expect(result).toBeTruthy()
    })
  })

  describe('isInquiryReplied', () => {
    it('should return true when inquiry has reply', () => {
      const inquiry = { question: 'test', supplierId: '1', supplierName: 'test', createdAt: '2026-05-01', reply: 'نعم، متوفر', repliedAt: '2026-05-06' }
      expect(isInquiryReplied(inquiry)).toBe(true)
    })

    it('should return false when inquiry has no reply', () => {
      const inquiry = { question: 'test', supplierId: '1', supplierName: 'test', createdAt: '2026-05-01', reply: null, repliedAt: null }
      expect(isInquiryReplied(inquiry)).toBe(false)
    })
  })

  describe('getInquiryStatus', () => {
    it('should return answered status', () => {
      const inquiry = { question: 'test', supplierId: '1', supplierName: 'test', createdAt: '2026-05-01', reply: 'نعم', repliedAt: '2026-05-06' }
      expect(getInquiryStatus(inquiry)).toBe('مجابة')
    })

    it('should return pending status', () => {
      const inquiry = { question: 'test', supplierId: '1', supplierName: 'test', createdAt: '2026-05-01', reply: null, repliedAt: null }
      expect(getInquiryStatus(inquiry)).toBe('في انتظار الرد')
    })
  })
})