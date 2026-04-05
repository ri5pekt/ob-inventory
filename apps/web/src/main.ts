import { createApp } from 'vue'
import { createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import ToastService from 'primevue/toastservice'
import ConfirmationService from 'primevue/confirmationservice'
import { VueQueryPlugin } from '@tanstack/vue-query'
import 'primeicons/primeicons.css'
import './style.css'
import { OBTheme } from './theme'
import { router } from './router'
import App from './App.vue'

// PrimeVue components — registered globally so they resolve correctly
// even in lazily-mounted child components (modals, etc.)
import Tooltip     from 'primevue/tooltip'
import Button      from 'primevue/button'
import InputText   from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Textarea    from 'primevue/textarea'
import Select      from 'primevue/select'
import DatePicker  from 'primevue/datepicker'
import Dialog      from 'primevue/dialog'
import DataTable   from 'primevue/datatable'
import Column      from 'primevue/column'
import ColumnGroup from 'primevue/columngroup'
import Row         from 'primevue/row'
import Tag         from 'primevue/tag'
import Badge       from 'primevue/badge'
import Message     from 'primevue/message'
import Divider     from 'primevue/divider'
import Tabs        from 'primevue/tabs'
import TabList     from 'primevue/tablist'
import Tab         from 'primevue/tab'
import TabPanels   from 'primevue/tabpanels'
import TabPanel    from 'primevue/tabpanel'
import Chip          from 'primevue/chip'
import ProgressBar   from 'primevue/progressbar'
import Skeleton      from 'primevue/skeleton'
import Toast         from 'primevue/toast'
import ConfirmDialog from 'primevue/confirmdialog'
import Password      from 'primevue/password'
import Checkbox      from 'primevue/checkbox'
import TabView       from 'primevue/tabview'
import MultiSelect   from 'primevue/multiselect'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(PrimeVue, {
  theme: {
    preset: OBTheme,
    options: { darkModeSelector: '.dark' },
  },
  zIndex: {
    modal: 1100,
    overlay: 1200, // Select/dropdown overlays above modals so they're not clipped
  },
})
app.use(ToastService)
app.use(ConfirmationService)
app.use(VueQueryPlugin)

app.component('Button',      Button)
app.component('InputText',   InputText)
app.component('InputNumber', InputNumber)
app.component('Textarea',    Textarea)
app.component('Select',      Select)
app.component('DatePicker',  DatePicker)
app.component('Dialog',      Dialog)
app.component('DataTable',   DataTable)
app.component('Column',      Column)
app.component('ColumnGroup', ColumnGroup)
app.component('Row',         Row)
app.component('Tag',         Tag)
app.component('Badge',       Badge)
app.component('Message',     Message)
app.component('Divider',     Divider)
app.component('Tabs',        Tabs)
app.component('TabList',     TabList)
app.component('Tab',         Tab)
app.component('TabPanels',   TabPanels)
app.component('TabPanel',    TabPanel)
app.component('Chip',          Chip)
app.component('ProgressBar',   ProgressBar)
app.component('Skeleton',      Skeleton)
app.component('Toast',         Toast)
app.component('ConfirmDialog', ConfirmDialog)
app.component('Password',      Password)
app.component('Checkbox',      Checkbox)
app.component('TabView',       TabView)
app.component('MultiSelect',   MultiSelect)

app.directive('tooltip', Tooltip)

app.mount('#app')
