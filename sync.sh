# (cd ~/src/vowpal_wabbit/wasm_build/; make -j4) || exit -1
# cp ~/src/vowpal_wabbit/wasm/vwslim.wasm . 
# cp ~/src/vowpal_wabbit/wasm/vwslim.js .

(cd ~/src/vowpal_wabbit/wasm_build/wasm; make -j4) || exit -1
cp ~/src/vowpal_wabbit/wasm/vw-wasm-full.wasm.wasm vw.wasm
cp ~/src/vowpal_wabbit/wasm/vw-wasm-full.wasm.js vw.js

echo 'done'