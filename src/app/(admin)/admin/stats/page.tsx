
"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts"
import { TrendingUp, Users, FileText, ShoppingCart } from "lucide-react"

const data = [
  { name: 'يناير', rfqs: 40, offers: 240 },
  { name: 'فبراير', rfqs: 30, offers: 198 },
  { name: 'مارس', rfqs: 60, offers: 320 },
  { name: 'أبريل', rfqs: 45, offers: 280 },
  { name: 'مايو', rfqs: 80, offers: 450 },
]

const pieData = [
  { name: 'حديد', value: 400 },
  { name: 'أسمنت', value: 300 },
  { name: 'كهرباء', value: 300 },
  { name: 'سباكة', value: 200 },
]

const COLORS = ['#2874D4', '#20CBD5', '#12A063', '#0B1F3A']

export default function AdminStatsPage() {
  return (
    <PortalLayout>
      <div className="space-y-8 text-right">
        <div>
          <h1 className="text-3xl font-bold text-secondary font-headline">الإحصائيات والتقارير</h1>
          <p className="text-muted-foreground mt-1">تحليل شامل لأداء المنصة ونمو العمليات التجارية</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card className="border-none shadow-sm">
            <CardContent className="p-6">
              <p className="text-sm text-muted-foreground">معدل النمو الشهري</p>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-2xl font-bold text-success">+15%</span>
                <TrendingUp size={20} className="text-success" />
              </div>
            </CardContent>
          </Card>
          {/* Add more metric cards if needed */}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <Card className="border-none shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">حجم المناقصات والعروض</CardTitle>
            </CardHeader>
            <CardContent className="h-[350px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} />
                  <YAxis axisLine={false} tickLine={false} />
                  <Tooltip />
                  <Bar dataKey="rfqs" fill="#2874D4" radius={[4, 4, 0, 0]} name="المناقصات" />
                  <Bar dataKey="offers" fill="#20CBD5" radius={[4, 4, 0, 0]} name="العروض" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">توزيع العمليات حسب الفئة</CardTitle>
            </CardHeader>
            <CardContent className="h-[350px] flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-col gap-2 mr-4">
                {pieData.map((entry, index) => (
                  <div key={entry.name} className="flex items-center gap-2 text-sm">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[index] }} />
                    <span className="text-muted-foreground">{entry.name}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </PortalLayout>
  )
}
