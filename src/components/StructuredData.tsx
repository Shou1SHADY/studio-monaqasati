export default function StructuredData() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        name: 'Mdmak Tech',
        alternateName: 'مدماك تيك',
        url: 'https://mdmaktech.sa',
        logo: 'https://mdmaktech.sa/logo.png',
        contactPoint: {
          '@type': 'ContactPoint',
          email: 'info.mdmak@mdmaktech.sa',
          contactType: 'customer support',
        },
        sameAs: [],
      },
      {
        '@type': 'WebSite',
        name: 'Mdmak Tech',
        alternateName: 'مدماك تيك',
        url: 'https://mdmaktech.sa',
        inLanguage: ['ar', 'en'],
        potentialAction: {
          '@type': 'SearchAction',
          target: 'https://mdmaktech.sa/search?q={search_term_string}',
          'query-input': 'required name=search_term_string',
        },
      },
    ],
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  )
}
