# **App Name**: مدماك تيك

## Core Features:

- User Authentication & Role Management: Secure Firebase Authentication with phone number (OTP) and email/password. Implements role-based routing and middleware protection to direct users to their respective Supplier, Contractor, or Admin dashboards and control access.
- Supplier Portal Core Functions: Provides suppliers with a dashboard overview of their activity, enables viewing and submitting offers for available RFQs, managing their assigned orders, and updating their profile details including specializations and service areas.
- Contractor Portal Core Functions: Allows contractors to manage their dashboard, create new multi-step RFQs, review offers received, accept or decline offers, browse a directory of verified suppliers, and maintain their profile and commitment score.
- Admin Portal & Platform Control: Offers administrators a dashboard with platform-wide metrics, comprehensive tools to manage all suppliers and contractors (including verification, suspension, and editing), view all RFQs, and access a notification log.
- Smart RFQ-Supplier Matching Tool: An AI-powered tool that intelligently suggests relevant RFQs to suppliers based on their specialization categories and service areas, and recommends suitable suppliers to contractors for their RFQs.
- In-App Notifications System: A robust in-app notification system that alerts users to important updates such as new RFQs, offer status changes, and administrative messages, with clear read/unread states.
- Firestore Data Persistence: Leverages Firestore for all application data storage, including users, RFQs, offers, and notifications, ensuring real-time data synchronization and scalable data management for the platform.

## Style Guidelines:

- Primary interactive blue: #2874D4, representing trust and professionalism, used for buttons, links, and key highlights.
- Background soft blue-grey: #ECF2F9, providing a light, calming canvas that enhances readability.
- Accent vivid cyan: #20CBD5, used to draw attention to secondary actions or distinctive UI elements.
- Sidebar navigation dark navy: #0B1F3A, offering a strong visual anchor and contrast for the main navigation.
- Content cards white: #FFFFFF, with a subtle 1px border of #E2E8F0 and 12px radius, providing a clean, organized presentation for content blocks.
- Semantic success green: #12A063, specifically used for indicating successful actions or positive statuses.
- All text will use 'IBM Plex Sans Arabic', a sans-serif font, ensuring full Arabic UI and elegant readability for all content, set in an RTL layout. Note: currently only Google Fonts are supported.
- Utilize a consistent set of clear, professional, and intuitive icons that support the Arabic UI and facilitate quick understanding of functions and statuses.
- The entire platform features an RTL (Right-to-Left) layout. Navigation is handled by a persistent dark navy sidebar. Content is organized into clean, white, card-style components with subtle borders and rounded corners, optimizing for clarity and usability.
- Subtle and purposeful animations and transitions will be implemented for page changes, form submissions, and interactive elements, enhancing the user experience without causing distraction.