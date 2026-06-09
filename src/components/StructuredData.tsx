export default function StructuredData() {
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'مدماك تيك',
      alternateName: 'Mdmak Tech',
      url: 'https://mdmaktech.sa',
      image: 'https://mdmaktech.sa/og-image.jpg',
      logo: 'https://mdmaktech.sa/android-chrome-512x512.png',
      applicationCategory: 'BusinessApplication',
      applicationSubCategory: 'Procurement & Supply Chain Platform',
      description: 'Mdmak Tech is a B2B digital procurement platform connecting contractors with verified suppliers through automated smart tendering, price comparison, and order management. Currently serving Saudi Arabia with global expansion planned.',
      inLanguage: ['ar', 'en'],
      operatingSystem: 'Web',
      browserRequirements: 'Requires a modern web browser with JavaScript enabled',
      datePublished: '2026-01-01',
      author: {
        '@type': 'Organization',
        name: 'Mdmak Tech',
        url: 'https://mdmaktech.sa',
      },
      offers: [
        {
          '@type': 'Offer',
          name: 'Starter',
          price: '0',
          priceCurrency: 'SAR',
          description: 'Free plan — up to 5 tenders per month with basic features',
        },
        {
          '@type': 'Offer',
          name: 'Professional Growth',
          description: 'Higher volume tenders and advanced features',
        },
        {
          '@type': 'Offer',
          name: 'Enterprise',
          description: 'Custom pricing — ERP integration, dedicated account manager, advanced reporting',
        },
      ],
      areaServed: [
        {
          '@type': 'Country',
          name: 'Saudi Arabia',
          sameAs: 'https://www.wikidata.org/wiki/Q851',
        },
      ],
      featureList: [
        'Smart digital tendering system',
        'RFQ (Request for Quotation) management',
        'Automated price comparison',
        'Verified supplier network',
        'Real-time procurement analytics',
        'Digital contract and order management',
        'Payment and delivery tracking',
        'ERP integration',
        'Supplier rating and review system',
        'Multi-language: Arabic and English',
      ],
      keywords: 'منصة مناقصات, مشتريات رقمية, مقاولين وموردين, سلاسل الإمداد, أتمتة المشتريات, السعودية, رؤية 2030, procurement platform, Saudi Arabia, B2B marketplace, supplier management, digital tendering, supply chain automation',
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Mdmak Tech',
      alternateName: 'مدماك تيك',
      url: 'https://mdmaktech.sa',
      logo: 'https://mdmaktech.sa/android-chrome-512x512.png',
      image: 'https://mdmaktech.sa/og-image.jpg',
      description: 'B2B digital procurement platform for contractors and suppliers. Currently serving Saudi Arabia with global expansion planned.',
      foundingDate: '2026',
      foundingLocation: {
        '@type': 'Country',
        name: 'Saudi Arabia',
      },
      address: {
        '@type': 'PostalAddress',
        addressLocality: 'Riyadh',
        addressCountry: 'SA',
      },
      areaServed: [
        {
          '@type': 'Country',
          name: 'Saudi Arabia',
        },
      ],
      slogan: 'أتمتة الإمداد بذكاء وشفافية مطلقة',
      knowsAbout: [
        'Procurement Automation',
        'Supply Chain Management',
        'B2B Marketplace',
        'Digital Tendering',
        'Supplier Management',
        'RFQ Systems',
        'ERP Integration',
        'Saudi Vision 2030',
        'المشتريات الرقمية',
        'إدارة سلاسل الإمداد',
      ],
      contactPoint: {
        '@type': 'ContactPoint',
        contactType: 'customer support',
        email: 'info.mdmak@mdmaktech.sa',
        url: 'https://mdmaktech.sa/contact',
        availableLanguage: ['Arabic', 'English'],
      },
      sameAs: [
        'https://www.linkedin.com/company/mdmaktech',
        'https://twitter.com/mdmaktech',
      ],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'مدماك تيك | Mdmak Tech',
      alternateName: 'Mdmak Tech',
      url: 'https://mdmaktech.sa',
      image: 'https://mdmaktech.sa/og-image.jpg',
      description: 'B2B digital procurement platform — smart tendering, RFQ management, and supplier connectivity for Saudi Arabia.',
      inLanguage: ['ar', 'en'],
      potentialAction: {
        '@type': 'SearchAction',
        target: 'https://mdmaktech.sa/search?q={search_term_string}',
        'query-input': 'required name=search_term_string',
      },
    },
  ]

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  )
}
