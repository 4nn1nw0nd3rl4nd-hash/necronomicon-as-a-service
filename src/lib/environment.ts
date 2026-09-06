// Only an explicit production value may hide the test-system indicator.
export const isProductionEnvironment =
  import.meta.env.VITE_APP_ENV === 'production'
