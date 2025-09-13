# 供上游应用在合并 R8 时继承；目前保守默认
-keep @androidx.annotation.Keep class * { *; }
-keepclassmembers class * { @androidx.annotation.Keep *; }

# （如你的库对外暴露反射/序列化入口，可在此补充）
