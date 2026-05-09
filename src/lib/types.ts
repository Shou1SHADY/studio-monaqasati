export type UserRole = 'Admin' | 'Contractor' | 'Supplier';
export type OrganizationRole = 'owner' | 'member';

export interface UserProfile {
  uid: string;
  email: string;
  name: string;
  role: UserRole;
  organizationId: string;
  organizationRole: OrganizationRole;
  companyName?: string;
  crNumber?: string;
  phone?: string;
  city?: string;
  location?: string;
  description?: string;
  website?: string;
  profileCompleted: boolean;
  createdAt: string;
  updatedAt: string;
  // Role specific fields
  specializations?: string[]; // for suppliers
  serviceAreas?: string[];   // for suppliers
}

export interface RFQ {
  id: string;
  organizationId: string; // Linked to organization
  contractorId: string;   // The specific user who created it
  title: string;
  description: string;
  category: string;
  status: 'New' | 'Active' | 'Under Review' | 'Closed';
  createdAt: string;
  deadline: string;
  // ... other fields
}

export interface Offer {
  id: string;
  rfqId: string;
  organizationId: string; // Linked to organization (Supplier)
  supplierId: string;     // The specific user who submitted it
  price: number;
  status: 'Pending' | 'Accepted' | 'Rejected' | 'Price Reduction Requested';
  createdAt: string;
  // ... other fields
}
