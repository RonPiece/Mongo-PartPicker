# Mongo-PartPicker - אפיון מסד הנתונים

## תיאור הפרויקט
מערכת לניהול קטלוג רכיבי חומרה ובניית מפרטי מחשב.

## מבנה האוספים
```
MongoPartPicker/
├── components    (Embedded + Polymorphic)
├── builds        (Referenced)
└── users         (Referenced + Nested Arrays)
```

## Polymorphic Pattern
כל סוג רכיב יש לו מבנה specs שונה:
- CPU: socket, cores, tdp, score, requirements
- GPU: vram, length_mm, score  
- Motherboard: socket, chipset, ram_type

## Nested Arrays (מערכים מקוננים)
מבנה היררכי תלת-שכבתי ב-users:
```
User
└── orders[]           (מערך הזמנות)
    └── items[]        (מערך פריטים בכל הזמנה)
        ├── type
        ├── price
        └── quantity
```
דוגמה:
```javascript
{
  username: "gamer2024",
  orders: [
    {
      order_id: 1001,
      items: [  // <-- מערך בתוך מערך!
        { type: "GPU", price: 1599, quantity: 1 },
        { type: "CPU", price: 589, quantity: 1 }
      ]
    }
  ]
}
```

## Embedded vs Referenced

### Embedded (מוטמע):
- reviews[] - ביקורות בתוך components
- price_history[] - היסטוריית מחירים
- orders[].items[] - פריטים בתוך הזמנות

### Referenced (הפניות):
- builds.parts[] → ObjectIds של components
- users.saved_builds[] → ObjectIds של builds

## Rule Engine
שדה requirements ב-CPU מגדיר תאימות:
```
requirements: {
  socket_match: "LGA1700",
  ram_generation: "DDR5"
}
```

## MapReduce עם לולאות מקוננות
```javascript
// לולאה על orders
for (i in orders) {
  // לולאה על items (NESTED!)
  for (j in orders[i].items) {
    if (item.type === "GPU") ...
  }
}
```

## יתרונות
| תכונה | יתרון |
|--------|--------|
| Polymorphic | גמישות לסוגי רכיבים |
| Nested Arrays | מבנה היררכי מורכב |
| Embedded | ביצועים - שליפה אחת |
| Referenced | נורמליזציה |

## שמות המגישים:
[שם 1], [שם 2]
