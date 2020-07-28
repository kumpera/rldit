(cd ~/src/vowpal_wabbit/wasm_build/; make -j4) || exit -1
cp ~/src/vowpal_wabbit/wasm/vwslim.wasm . 
cp ~/src/vowpal_wabbit/wasm/vwslim.js .
echo 'done'