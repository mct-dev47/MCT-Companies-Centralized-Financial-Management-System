import * as React from 'react'

interface PlaceholderPageProps {
  title: string
}

export const PlaceholderPage: React.FC<PlaceholderPageProps> = ({ title }) => {
  return (
    <div className="flex flex-col items-start space-y-2 py-4">
      <h1 className="text-2xl sm:text-3xl font-bold text-focus">{title}</h1>
      <p className="text-base text-muted-fg font-normal">Coming soon</p>
    </div>
  )
}
