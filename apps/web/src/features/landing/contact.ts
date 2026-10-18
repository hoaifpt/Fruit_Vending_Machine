export function getContactLinks(emailValue?: string, phoneValue?: string) {
  const email = emailValue?.trim() ?? ''
  const phone = phoneValue?.trim() ?? ''
  const validEmail = /^[^\s@?&#%:]+@[^\s@?&#%:]+\.[^\s@?&#%:]+$/.test(email)
  const validPhone = /^\+?[\d ().-]{7,24}$/.test(phone) && phone.replace(/\D/g, '').length >= 7
  return {
    email: validEmail ? { label: email, href: `mailto:${email}?subject=${encodeURIComponent('Trao đổi hợp tác đặt máy Fruit Vending')}` } : null,
    phone: validPhone ? { label: phone, href: `tel:${phone.replace(/[^\d+]/g, '')}` } : null,
  }
}
