import { CATEGORIES_DATA, PREDEFINED_CATEGORIES, SAUDI_CITIES } from '../lib/constants'

describe('Constants', () => {
  describe('CATEGORIES_DATA', () => {
    it('should have valid category structure', () => {
      expect(Object.keys(CATEGORIES_DATA).length).toBeGreaterThan(0)
      expect(CATEGORIES_DATA).toHaveProperty('حديد ومعادن')
      expect(CATEGORIES_DATA).toHaveProperty('أسمنت وخرسانة')
    })

    it('should have subcategories for each main category', () => {
      Object.entries(CATEGORIES_DATA).forEach(([category, subCategories]) => {
        expect(Array.isArray(subCategories)).toBe(true)
        expect(subCategories.length).toBeGreaterThan(0)
      })
    })

    it('should contain expected categories', () => {
      expect(CATEGORIES_DATA).toHaveProperty('حديد ومعادن')
      expect(CATEGORIES_DATA['حديد ومعادن']).toContain('حديد تسليح')
      expect(CATEGORIES_DATA['أدوات صحية وسباكة']).toContain('مواسير PPR')
    })
  })

  describe('PREDEFINED_CATEGORIES', () => {
    it('should be an array of category names', () => {
      expect(Array.isArray(PREDEFINED_CATEGORIES)).toBe(true)
      expect(PREDEFINED_CATEGORIES.length).toBeGreaterThan(0)
    })

    it('should contain all main category keys', () => {
      expect(PREDEFINED_CATEGORIES).toContain('حديد ومعادن')
      expect(PREDEFINED_CATEGORIES).toContain('أسمنت وخرسانة')
      expect(PREDEFINED_CATEGORIES).toContain('أرضيات وتشطيبات')
    })
  })

  describe('SAUDI_CITIES', () => {
    it('should contain major Saudi cities', () => {
      expect(SAUDI_CITIES).toContain('الرياض')
      expect(SAUDI_CITIES).toContain('جدة')
      expect(SAUDI_CITIES).toContain('الدمام')
    })

    it('should have unique cities', () => {
      const uniqueCities = new Set(SAUDI_CITIES)
      expect(uniqueCities.size).toBe(SAUDI_CITIES.length)
    })
  })
})

describe('RFQ Data Structure', () => {
  const mockRfqData = {
    contractorId: 'contractor-123',
    title: 'توريد حديد تسليح',
    category: 'حديد ومعادن',
    subCategory: 'حديد تسليح',
    products: [
      { name: 'حديد تسليح', quantity: 100, unitOfMeasure: 'طن', description: 'حديد سابك' }
    ],
    deadline: '2026-06-01',
    city: 'الرياض',
    district: 'شمال الرياض',
    locationCoords: { lat: 24.7136, lng: 46.6753 },
    paymentTerms: 'كاش',
    isQualityCertificateRequired: true,
    visibility: 'public',
    notes: 'ملاحظات خاصة',
    pdfUrl: 'https://example.com/file.pdf',
    status: 'New',
    createdAt: new Date().toISOString()
  }

  it('should have valid RFQ structure', () => {
    expect(mockRfqData).toHaveProperty('title')
    expect(mockRfqData).toHaveProperty('category')
    expect(mockRfqData).toHaveProperty('products')
    expect(mockRfqData).toHaveProperty('pdfUrl')
  })

  it('should support multiple products', () => {
    const multiProductRfq = {
      contractorId: mockRfqData.contractorId,
      title: mockRfqData.title,
      category: mockRfqData.category,
      subCategory: mockRfqData.subCategory,
      products: [
        { name: 'حديد تسليح', quantity: 100, unitOfMeasure: 'طن', description: 'حديد سابك' },
        { name: 'شبك حديد', quantity: 50, unitOfMeasure: 'متر', description: 'مش' }
      ],
      deadline: mockRfqData.deadline,
      city: mockRfqData.city,
      district: mockRfqData.district,
      locationCoords: mockRfqData.locationCoords,
      paymentTerms: mockRfqData.paymentTerms,
      isQualityCertificateRequired: mockRfqData.isQualityCertificateRequired,
      visibility: mockRfqData.visibility,
      notes: mockRfqData.notes,
      pdfUrl: mockRfqData.pdfUrl,
      status: mockRfqData.status,
      createdAt: mockRfqData.createdAt
    }
    expect(multiProductRfq.products.length).toBe(2)
  })

  it('should have optional pdfUrl', () => {
    const rfqWithoutPdf = {
      contractorId: mockRfqData.contractorId,
      title: mockRfqData.title,
      category: mockRfqData.category,
      subCategory: mockRfqData.subCategory,
      products: mockRfqData.products,
      deadline: mockRfqData.deadline,
      city: mockRfqData.city,
      district: mockRfqData.district,
      locationCoords: mockRfqData.locationCoords,
      paymentTerms: mockRfqData.paymentTerms,
      isQualityCertificateRequired: mockRfqData.isQualityCertificateRequired,
      visibility: mockRfqData.visibility,
      notes: mockRfqData.notes,
      pdfUrl: null,
      status: mockRfqData.status,
      createdAt: mockRfqData.createdAt
    }
    expect(rfqWithoutPdf.pdfUrl).toBeNull()
  })
})

describe('Inquiry Data Structure', () => {
  const mockInquiry = {
    question: 'ما هو تاريخ التسليم؟',
    supplierId: 'supplier-123',
    supplierName: 'مورد مواد بناء',
    createdAt: new Date().toISOString(),
    reply: null,
    repliedAt: null
  }

  it('should have valid inquiry structure', () => {
    expect(mockInquiry).toHaveProperty('question')
    expect(mockInquiry).toHaveProperty('supplierId')
    expect(mockInquiry).toHaveProperty('supplierName')
  })

  it('should support replies', () => {
    const repliedInquiry = {
      question: mockInquiry.question,
      supplierId: mockInquiry.supplierId,
      supplierName: mockInquiry.supplierName,
      createdAt: mockInquiry.createdAt,
      reply: 'سيتم التسليم خلال 7 أيام',
      repliedAt: new Date().toISOString()
    }
    expect(repliedInquiry.reply).toBe('سيتم التسليم خلال 7 أيام')
    expect(repliedInquiry.repliedAt).not.toBeNull()
  })
})

describe('Offer Data Structure', () => {
  const mockOffer = {
    supplierId: 'supplier-123',
    rfqId: 'rfq-123',
    rfqTitle: 'توريد حديد تسليح',
    contractorId: 'contractor-123',
    price: 50000,
    deliveryMethod: 'شاحنات خاصة',
    deliveryFrequency: 'دفعة واحدة',
    isFreeShipping: true,
    includesSample: true,
    deliveryBatches: [
      { location: 'الرياض', deliveryDate: '2026-06-15', price: 25000 },
      { location: 'جدة', deliveryDate: '2026-06-20', price: 25000 }
    ],
    totalBatchesPrice: 50000,
    status: 'قيد المراجعة',
    createdAt: new Date().toISOString()
  }

  it('should have valid offer structure', () => {
    expect(mockOffer).toHaveProperty('price')
    expect(mockOffer).toHaveProperty('isFreeShipping')
    expect(mockOffer).toHaveProperty('includesSample')
  })

  it('should support free shipping toggle', () => {
    expect(mockOffer.isFreeShipping).toBe(true)
    const offerWithoutFreeShipping = {
      supplierId: mockOffer.supplierId,
      rfqId: mockOffer.rfqId,
      rfqTitle: mockOffer.rfqTitle,
      contractorId: mockOffer.contractorId,
      price: mockOffer.price,
      deliveryMethod: mockOffer.deliveryMethod,
      deliveryFrequency: mockOffer.deliveryFrequency,
      isFreeShipping: false,
      includesSample: mockOffer.includesSample,
      deliveryBatches: mockOffer.deliveryBatches,
      totalBatchesPrice: mockOffer.totalBatchesPrice,
      status: mockOffer.status,
      createdAt: mockOffer.createdAt
    }
    expect(offerWithoutFreeShipping.isFreeShipping).toBe(false)
  })

  it('should support sample availability toggle', () => {
    expect(mockOffer.includesSample).toBe(true)
    const offerWithoutSample = {
      supplierId: mockOffer.supplierId,
      rfqId: mockOffer.rfqId,
      rfqTitle: mockOffer.rfqTitle,
      contractorId: mockOffer.contractorId,
      price: mockOffer.price,
      deliveryMethod: mockOffer.deliveryMethod,
      deliveryFrequency: mockOffer.deliveryFrequency,
      isFreeShipping: mockOffer.isFreeShipping,
      includesSample: false,
      deliveryBatches: mockOffer.deliveryBatches,
      totalBatchesPrice: mockOffer.totalBatchesPrice,
      status: mockOffer.status,
      createdAt: mockOffer.createdAt
    }
    expect(offerWithoutSample.includesSample).toBe(false)
  })

  it('should support multiple delivery batches', () => {
    expect(mockOffer.deliveryBatches.length).toBe(2)
  })
})