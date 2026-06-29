export default function RootPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30">
      <div className="text-center">
        <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-primary text-primary-foreground text-xl font-bold mb-6">
          i
        </div>
        <h1 className="text-2xl font-bold text-foreground mb-2">Client Portal</h1>
        <p className="text-muted-foreground text-sm">
          Zaloguj się korzystając z linku podanego przez agencję.
        </p>
      </div>
    </div>
  )
}
