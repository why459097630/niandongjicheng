package com.ndjc.dice

import android.os.Bundle
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // 最简 UI，避免依赖布局文件
        val tv = TextView(this)
        tv.text = "Hello from NDJC!"
        tv.textSize = 24f
        setContentView(tv)
    }
}
