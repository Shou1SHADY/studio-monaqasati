export default function StructuredData() {
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SoftwareApplication',
        '@id': 'https://mdmaktech.sa/#software',
        name: 'مدماك تيك',
        alternateName: 'Mdmak Tech',
        url: 'https://mdmaktech.sa',
        image: 'https://mdmaktech.sa/og-image.jpg',
        logo: 'https://mdmaktech.sa/android-chrome-512x512.png',
        applicationCategory: 'BusinessApplication',
        description:
          'Mdmak Tech is a B2B digital procurement platform connecting contractors with verified suppliers through automated smart tendering, price comparison, and order management. Currently serving Saudi Arabia with global expansion planned.',
        inLanguage: ['ar', 'en'],
        operatingSystem: 'Web',
        browserRequirements: 'Requires a modern web browser with JavaScript enabled',
        datePublished: '2026-01-01',
        author: {
          '@id': 'https://mdmaktech.sa/#organization',
        },
        offers: [
          {
            '@type': 'Offer',
            name: 'Starter',
            price: '0',
            priceCurrency: 'SAR',
            description: 'Free plan — up to 5 tenders per month with basic features',
            url: 'https://mdmaktech.sa/pricing',
            availability: 'https://schema.org/InStock',
          },
          {
            '@type': 'Offer',
            name: 'Professional Growth',
            description: 'Higher volume tenders and advanced procurement features',
            url: 'https://mdmaktech.sa/pricing',
            priceSpecification: {
              '@type': 'PriceSpecification',
              priceCurrency: 'SAR',
              description: 'Contact sales for pricing',
            },
          },
          {
            '@type': 'Offer',
            name: 'Enterprise',
            description: 'Custom pricing — ERP integration, dedicated account manager, advanced reporting',
            url: 'https://mdmaktech.sa/pricing',
            priceSpecification: {
              '@type': 'PriceSpecification',
              priceCurrency: 'SAR',
              description: 'Custom enterprise pricing — contact sales',
            },
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
      },
      {
        '@type': 'Organization',
        '@id': 'https://mdmaktech.sa/#organization',
        name: 'Mdmak Tech',
        alternateName: 'مدماك تيك',
        url: 'https://mdmaktech.sa',
        logo: 'https://mdmaktech.sa/android-chrome-512x512.png',
        image: 'https://mdmaktech.sa/og-image.jpg',
        description: 'B2B digital procurement platform for contractors and suppliers in Saudi Arabia.',
        foundingDate: '2026',
        foundingLocation: {
          '@type': 'Country',
          name: 'Saudi Arabia',
          sameAs: 'https://www.wikidata.org/wiki/Q851',
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
            sameAs: 'https://www.wikidata.org/wiki/Q851',
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
          contactType: 'customer service',
          email: 'info@mdmaktech.sa',
          url: 'https://mdmaktech.sa/contact',
          availableLanguage: ['Arabic', 'English'],
        },
        sameAs: [
          'https://www.linkedin.com/company/mdmaktech',
          'https://x.com/mdmaktech',
          'https://www.instagram.com/mdmaktech.sa',
        ],
      },
      {
        '@type': 'WebSite',
        '@id': 'https://mdmaktech.sa/#website',
        name: 'مدماك تيك | Mdmak Tech',
        alternateName: 'Mdmak Tech',
        url: 'https://mdmaktech.sa',
        image: 'https://mdmaktech.sa/og-image.jpg',
        description: 'B2B digital procurement platform — smart tendering, RFQ management, and supplier connectivity for Saudi Arabia.',
        inLanguage: ['ar', 'en'],
        publisher: {
          '@id': 'https://mdmaktech.sa/#organization',
        },
      },
      {
        '@type': 'Service',
        '@id': 'https://mdmaktech.sa/#service',
        name: 'Smart Procurement & RFQ Platform',
        alternateName: 'منصة المناقصات الذكية وإدارة عروض الأسعار',
        serviceType: 'B2B Procurement Platform',
        description:
          'Digital procurement service connecting Saudi construction contractors with verified material suppliers through automated tendering, competitive RFQ management, and intelligent price comparison.',
        provider: {
          '@id': 'https://mdmaktech.sa/#organization',
        },
        areaServed: {
          '@type': 'Country',
          name: 'Saudi Arabia',
          sameAs: 'https://www.wikidata.org/wiki/Q851',
        },
        url: 'https://mdmaktech.sa',
        inLanguage: ['ar', 'en'],
      },
      {
        // FAQPage — Google SERP rich result retired May 7 2026.
        // Value: AI/LLM citation signal, entity resolution, voice search.
        '@type': 'FAQPage',
        '@id': 'https://mdmaktech.sa/#faq',
        name: 'Frequently Asked Questions — Mdmak Tech',
        url: 'https://mdmaktech.sa',
        mainEntity: [
          {
            '@type': 'Question',
            name: 'How does Mdmak Tech connect contractors with suppliers in Saudi Arabia?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'Mdmak Tech is a B2B procurement platform where contractors post tenders and RFQs, and verified suppliers submit competitive quotes. The platform streamlines the entire sourcing process — from posting requirements to comparing offers and awarding contracts — all in one place.',
            },
          },
          {
            '@type': 'Question',
            name: 'Is Mdmak Tech free to use?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'Yes, contractors and suppliers can register and start using the platform for free. The Starter plan includes up to 5 tenders per month with basic quotation features. For higher volumes and advanced features, we offer Professional Growth and Enterprise plans.',
            },
          },
          {
            '@type': 'Question',
            name: 'What construction materials can I source through the platform?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'You can request quotes for a wide range of construction materials including steel, cement, electrical supplies, paints, sanitary ware, HVAC systems, insulation, flooring, doors, and more. The platform supports all major categories used in Saudi construction projects.',
            },
          },
          {
            '@type': 'Question',
            name: 'How quickly do suppliers respond to RFQs?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'Suppliers are notified instantly when a new tender is published. Response times vary, but most suppliers submit their offers within 24 to 48 hours. The platform sends automatic reminders as the deadline approaches to ensure competitive participation.',
            },
          },
          {
            '@type': 'Question',
            name: 'Can Mdmak Tech handle large-scale construction projects?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'Mdmak Tech is built for projects of all sizes — from small renovations to large-scale commercial and infrastructure developments. The Enterprise plan includes ERP integration, dedicated account management, and advanced reporting for complex procurement needs.',
            },
          },
          {
            '@type': 'Question',
            name: 'How does Mdmak Tech ensure supplier quality?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'All suppliers undergo a verification process including commercial registration (CR) and tax certificate validation. The platform also features a rating and review system where contractors rate suppliers after each completed order, building a transparent reputation system.',
            },
          },
        ],
      },
    ],
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }}
    />
  )
}
